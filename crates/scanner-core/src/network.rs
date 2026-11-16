use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

fn private_v4(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_loopback()
}
fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || ip == Ipv4Addr::new(168, 63, 129, 16)
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && (b == 168 || b == 0 || (b == 88 && c == 99)))
        || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
        || (a == 203 && b == 0 && c == 113))
}
fn public_v6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    // Only global unicast; exclude transition, documentation and reserved ranges.
    (segments[0] & 0xe000) == 0x2000
        && segments[0] != 0x2002
        && !(segments[0] == 0x2001 && segments[1] <= 0x01ff)
        && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
        && !(segments[0] == 0x3fff && segments[1] <= 0x0fff)
}
pub fn address_allowed(ip: IpAddr, allow_private: bool) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4) || (allow_private && private_v4(v4)),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => address_allowed(IpAddr::V4(v4), allow_private),
            None => {
                let s = v6.segments();
                let cloud_metadata =
                    (s[0] == 0xfd00 && s[1] == 0x0ec2) || (s[0] == 0xfd20 && s[1] == 0x00ce);
                !cloud_metadata
                    && (public_v6(v6)
                        || (allow_private
                            && (v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00)))
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cloud_and_reserved_are_always_blocked() {
        for s in [
            "169.254.169.254",
            "fd00:ec2::254",
            "fd00:ec2::23",
            "fd20:ce::254",
            "168.63.129.16",
            "100.100.100.200",
            "192.0.2.1",
            "0.0.0.0",
            "::",
            "fe80::1",
            "2001:db8::1",
            "2002:7f00:1::",
            "::ffff:169.254.169.254",
        ] {
            for private in [true, false] {
                assert!(!address_allowed(s.parse().unwrap(), private), "{s}");
            }
        }
    }
    #[test]
    fn private_addresses_require_explicit_consent() {
        for s in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "::1",
            "fd00::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!address_allowed(s.parse().unwrap(), false), "{s}");
            assert!(address_allowed(s.parse().unwrap(), true), "{s}");
        }
    }
    #[test]
    fn public_global_unicast_is_allowed() {
        for s in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(address_allowed(s.parse().unwrap(), false), "{s}");
        }
    }
}
