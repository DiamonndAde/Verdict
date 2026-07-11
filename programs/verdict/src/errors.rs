use anchor_lang::prelude::*;

#[error_code]
pub enum VerdictError {
    // --- lifecycle ---
    #[msg("Market is not awaiting a taker")]
    MarketNotOpen,
    #[msg("Market is not active")]
    MarketNotActive,
    #[msg("You cannot accept your own challenge")]
    SelfAccept,
    #[msg("Stake must be greater than zero")]
    ZeroStake,
    #[msg("Market has not expired yet")]
    NotExpired,
    #[msg("Expiry must be in the future and after the settlement window opens")]
    InvalidExpiry,
    #[msg("Settlement window must open at a positive timestamp")]
    InvalidSettleAfter,
    #[msg("Vault is empty")]
    EmptyVault,
    #[msg("Token account is for the wrong mint")]
    WrongMint,
    #[msg("Token account is not owned by the expected party")]
    InvalidTokenAccountOwner,

    // --- predicate ---
    #[msg("Predicate is malformed: a second stat key requires an operator, and vice versa")]
    MalformedPredicate,
    #[msg("Predicate stat keys must be non-zero and distinct")]
    InvalidStatKeys,

    // --- settlement proof gates ---
    #[msg("Proof is for a different fixture than this market")]
    FixtureMismatch,
    #[msg("Proof payload has the wrong number of stats for this market's predicate")]
    WrongStatCount,
    #[msg("Proven stat key does not match the predicate stored at market creation")]
    StatKeyMismatch,
    #[msg("Proof is not from the final (game_finalised) record — settlement is not yet provable")]
    NotFinalRecord,
    #[msg("Proof predates this market's settlement window")]
    ProofTooEarly,
    #[msg("Proof timestamp is inconsistent with its own summary")]
    InconsistentProofTimestamp,
    #[msg("Proof timestamp is outside the representable epoch-day range")]
    EpochDayOutOfRange,
    #[msg("Proof payload exceeds size limits")]
    ProofTooLarge,

    // --- CPI safety ---
    #[msg("Provided program is not the pinned TxLINE oracle")]
    UntrustedOracleProgram,
    #[msg("Daily-roots account is not owned by the TxLINE oracle")]
    UntrustedRootsAccount,
    #[msg("Daily-roots account does not match the PDA for this proof's epoch day")]
    WrongRootsAccount,
    #[msg("Oracle CPI returned no data")]
    OracleReturnedNothing,
    #[msg("Return data was produced by a program other than the pinned TxLINE oracle")]
    SpoofedOracleReturnData,
    #[msg("Oracle return data is not a well-formed boolean")]
    MalformedOracleReturnData,

    #[msg("Arithmetic overflow")]
    Overflow,
}
