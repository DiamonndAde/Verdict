pub mod accept_market;
pub mod cancel_market;
pub mod create_market;
pub mod refund_expired;
pub mod settle;

// Glob re-export so the #[program] macro can reach Anchor's generated __client_accounts_*
// modules. The only ambiguity this introduces is the shared `handler` name across modules,
// which is never referenced through the glob (lib.rs calls handlers by module path).
#[allow(ambiguous_glob_reexports)]
mod reexports {
    pub use super::accept_market::*;
    pub use super::cancel_market::*;
    pub use super::create_market::*;
    pub use super::refund_expired::*;
    pub use super::settle::*;
}
pub use reexports::*;
