//! Observações TLS adicionais: propriedades do certificado leaf e sondas de handshake
//! mínimas (só ClientHello; a conexão é encerrada ao ler a primeira resposta).

use scanner_core::TlsProbe;
use sha2::{Digest, Sha256};
use std::{net::SocketAddr, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use x509_parser::prelude::*;

pub struct CertFacts {
    pub key_algorithm: String,
    pub key_bits: u32,
    pub signature_algorithm: String,
    pub weak_signature: bool,
    pub validity_days: i64,
    pub wildcard: bool,
}

pub fn cert_facts(cert: &X509Certificate<'_>) -> CertFacts {
    let (key_algorithm, key_bits) = match cert.public_key().parsed() {
        Ok(x509_parser::public_key::PublicKey::RSA(rsa)) => ("RSA", rsa.key_size() as u32),
        Ok(x509_parser::public_key::PublicKey::EC(ec)) => ("EC", ec.key_size() as u32),
        Ok(x509_parser::public_key::PublicKey::DSA(_)) => ("DSA", 0),
        _ => ("outro", 0),
    };
    let oid = cert.signature_algorithm.algorithm.to_id_string();
    let (signature_algorithm, weak_signature) = match oid.as_str() {
        "1.2.840.113549.1.1.4" => ("md5WithRSAEncryption", true),
        "1.2.840.113549.1.1.5" => ("sha1WithRSAEncryption", true),
        "1.2.840.10045.4.1" => ("ecdsa-with-SHA1", true),
        "1.2.840.10040.4.3" => ("dsa-with-SHA1", true),
        "1.2.840.113549.1.1.11" => ("sha256WithRSAEncryption", false),
        "1.2.840.113549.1.1.12" => ("sha384WithRSAEncryption", false),
        "1.2.840.113549.1.1.13" => ("sha512WithRSAEncryption", false),
        "1.2.840.113549.1.1.10" => ("RSASSA-PSS", false),
        "1.2.840.10045.4.3.2" => ("ecdsa-with-SHA256", false),
        "1.2.840.10045.4.3.3" => ("ecdsa-with-SHA384", false),
        "1.2.840.10045.4.3.4" => ("ecdsa-with-SHA512", false),
        "1.3.101.112" => ("Ed25519", false),
        _ => ("desconhecido", false),
    };
    let validity = cert.validity();
    let validity_days = (validity.not_after.timestamp() - validity.not_before.timestamp()) / 86_400;
    let wildcard = cert
        .subject_alternative_name()
        .ok()
        .flatten()
        .is_some_and(|san| {
            san.value.general_names.iter().any(|n| {
                matches!(n, x509_parser::extensions::GeneralName::DNSName(d) if d.starts_with("*."))
            })
        });
    CertFacts {
        key_algorithm: key_algorithm.into(),
        key_bits,
        signature_algorithm: signature_algorithm.into(),
        weak_signature,
        validity_days,
        wildcard,
    }
}

/// Pacotes de cifra oferecidos nas sondas de protocolo legado (suportados por servidores TLS 1.0/1.1).
const LEGACY_SUITES: &[u16] = &[
    0xc02f, 0xc013, 0xc014, 0xc009, 0xc00a, 0x002f, 0x0035, 0x000a,
];
/// Cifras consideradas quebradas: RC4, 3DES, NULL, EXPORT e anônimas.
const WEAK_SUITES: &[u16] = &[
    0x0004, 0x0005, 0xc011, 0xc007, // RC4
    0x000a, 0xc012, 0xc008, 0x0016, // 3DES
    0x0001, 0x0002, 0x003b, // NULL
    0x0003, 0x0006, 0x0008, 0x0014, // EXPORT
    0x0018, 0x001b, 0x0034, 0x003a, // anônimas
];

pub fn client_hello(version: u16, host: &str, suites: &[u16]) -> Vec<u8> {
    let mut random = Sha256::digest(
        format!(
            "{host}{:?}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        )
        .as_bytes(),
    )
    .to_vec();
    random.truncate(32);
    let mut ext = vec![];
    // server_name
    let host = host.as_bytes();
    if !host.is_empty() && host.len() < 256 && host.iter().any(|b| b.is_ascii_alphabetic()) {
        let name_len = host.len() as u16;
        ext.extend([0x00, 0x00]);
        ext.extend((name_len + 5).to_be_bytes());
        ext.extend((name_len + 3).to_be_bytes());
        ext.push(0x00);
        ext.extend(name_len.to_be_bytes());
        ext.extend(host);
    }
    // supported_groups: x25519, secp256r1, secp384r1
    ext.extend([
        0x00, 0x0a, 0x00, 0x08, 0x00, 0x06, 0x00, 0x1d, 0x00, 0x17, 0x00, 0x18,
    ]);
    // ec_point_formats: uncompressed
    ext.extend([0x00, 0x0b, 0x00, 0x02, 0x01, 0x00]);
    // renegotiation_info vazio
    ext.extend([0xff, 0x01, 0x00, 0x01, 0x00]);
    if version >= 0x0303 {
        // signature_algorithms (obrigatório na prática para TLS 1.2)
        ext.extend([
            0x00, 0x0d, 0x00, 0x0e, 0x00, 0x0c, 0x04, 0x01, 0x05, 0x01, 0x06, 0x01, 0x04, 0x03,
            0x05, 0x03, 0x02, 0x01,
        ]);
    }
    let mut body = vec![];
    body.extend(version.to_be_bytes());
    body.extend(&random);
    body.push(0); // session id vazio
    body.extend(((suites.len() * 2) as u16).to_be_bytes());
    for s in suites {
        body.extend(s.to_be_bytes());
    }
    body.extend([0x01, 0x00]); // compressão: null
    body.extend((ext.len() as u16).to_be_bytes());
    body.extend(ext);
    let mut handshake = vec![0x01];
    handshake.extend(&(body.len() as u32).to_be_bytes()[1..]);
    handshake.extend(body);
    let mut record = vec![0x16, 0x03, 0x01];
    record.extend((handshake.len() as u16).to_be_bytes());
    record.extend(handshake);
    record
}

/// Interpreta a primeira resposta: `Some(true)` se o servidor aceitou a versão pedida,
/// `Some(false)` se recusou (alerta ou outra versão), `None` se inconclusivo.
pub fn interpret_response(head: &[u8], version: u16) -> Option<bool> {
    match head.first()? {
        0x15 => Some(false),
        0x16 => {
            // record(5) + handshake type(1) + len(3) + server_version(2)
            if head.len() < 11 || head[5] != 0x02 {
                return None;
            }
            Some(u16::from_be_bytes([head[9], head[10]]) == version)
        }
        _ => None,
    }
}

pub async fn probe(
    addr: SocketAddr,
    host: &str,
    version: u16,
    suites: &[u16],
    timeout: Duration,
) -> Option<bool> {
    let hello = client_hello(version, host, suites);
    let work = async {
        let mut stream = TcpStream::connect(addr).await.ok()?;
        stream.write_all(&hello).await.ok()?;
        let mut head = [0u8; 11];
        let mut read = 0;
        while read < head.len() {
            let n = stream.read(&mut head[read..]).await.ok()?;
            if n == 0 {
                // Encerrar sem resposta é a forma comum de recusar versões antigas.
                return if read == 0 { Some(false) } else { None };
            }
            read += n;
            if head[0] == 0x15 {
                break;
            }
        }
        let _ = stream.shutdown().await;
        interpret_response(&head[..read], version)
    };
    tokio::time::timeout(timeout, work).await.ok().flatten()
}

pub async fn probe_all(addr: SocketAddr, host: &str, timeout: Duration) -> TlsProbe {
    TlsProbe {
        tls10: probe(addr, host, 0x0301, LEGACY_SUITES, timeout).await,
        tls11: probe(addr, host, 0x0302, LEGACY_SUITES, timeout).await,
        weak_ciphers: probe(addr, host, 0x0303, WEAK_SUITES, timeout).await,
    }
}

/// Número de conexões abertas por [`probe_all`]; descontado do orçamento.
pub const PROBE_CONNECTIONS: u8 = 3;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_hello_is_well_formed() {
        let h = client_hello(0x0301, "example.com", LEGACY_SUITES);
        assert_eq!(h[0], 0x16);
        let record_len = u16::from_be_bytes([h[3], h[4]]) as usize;
        assert_eq!(record_len, h.len() - 5);
        assert_eq!(h[5], 0x01);
        let hs_len = u32::from_be_bytes([0, h[6], h[7], h[8]]) as usize;
        assert_eq!(hs_len, h.len() - 9);
        assert_eq!(&h[9..11], &[0x03, 0x01]);
        assert!(h.windows(11).any(|w| w == b"example.com"));
    }

    #[test]
    fn ip_hosts_do_not_send_sni() {
        let h = client_hello(0x0303, "203.0.113.5", WEAK_SUITES);
        assert!(!h.windows(11).any(|w| w == b"203.0.113.5"));
    }

    #[test]
    fn responses_are_interpreted() {
        let server_hello = [
            0x16, 0x03, 0x01, 0x00, 0x30, 0x02, 0x00, 0x00, 0x2c, 0x03, 0x01,
        ];
        assert_eq!(interpret_response(&server_hello, 0x0301), Some(true));
        assert_eq!(interpret_response(&server_hello, 0x0302), Some(false));
        assert_eq!(
            interpret_response(&[0x15, 0x03, 0x01, 0x00, 0x02], 0x0301),
            Some(false)
        );
        assert_eq!(interpret_response(&[0x48, 0x54], 0x0301), None);
    }

    #[tokio::test]
    async fn closed_connection_counts_as_refusal() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = [0; 512];
            let _ = s.read(&mut buf).await;
        });
        let r = probe(
            addr,
            "localhost",
            0x0301,
            LEGACY_SUITES,
            Duration::from_secs(2),
        )
        .await;
        task.abort();
        assert_eq!(r, Some(false));
    }
}
