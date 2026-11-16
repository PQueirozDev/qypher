# Dependências de terceiros

Qypher usa dependências open source com suas próprias licenças. Este inventário inicial não substitui a revisão do grafo completo após geração dos lockfiles e antes de redistribuição.

| Componente               | Uso                                              | Licença                                   |
| ------------------------ | ------------------------------------------------ | ----------------------------------------- |
| Inter (Fontsource)       | Fonte variável embarcada, sem requisição externa | SIL Open Font License 1.1                 |
| React / React DOM        | Interface                                        | MIT                                       |
| Lucide                   | Ícones da interface                              | ISC                                       |
| Tauri e plugins oficiais | Runtime e integração desktop                     | MIT / Apache-2.0                          |
| reqwest / rustls         | HTTP e TLS                                       | MIT / Apache-2.0 / ISC, conforme o pacote |
| SQLite / rusqlite        | Persistência local                               | domínio público / MIT                     |
| lopdf                    | Escrita e leitura de PDF                         | MIT                                       |

A fonte Inter mantém o copyright dos Inter Project Authors. Seu texto de licença está em `licenses/Inter-OFL.txt` e acompanha o pacote desktop em `licenses/`. Licenças React e Lucide também são incluídas. Antes de release, gere um inventário completo/SBOM e preserve os avisos exigidos por todas as dependências transitivas.
