pub mod compare;
pub mod model;
pub mod policy;
pub mod risk;
pub mod taxonomy;
pub use compare::*;
pub use model::*;
pub use policy::*;
pub use risk::{risk, risk_for_scan, RiskSummary};
pub use taxonomy::{cwe_url, taxonomy, Taxonomy};

pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub trait Detector: Send + Sync {
    fn id(&self) -> &'static str;
    fn version(&self) -> &'static str {
        "1.0.0"
    }
    fn analyze(&self, observation: &HttpObservation) -> CheckResult;
}

pub fn clean(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .take(limit)
        .collect()
}

pub mod network;
pub use network::address_allowed;
