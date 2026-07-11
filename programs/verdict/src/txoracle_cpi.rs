//! Hand-rolled CPI into the TxLINE `txoracle` program's `validate_stat_v2`.
//!
//! WHY NOT `declare_program!` / Anchor's generated CPI: Anchor's `Return<T>::get()` helper
//! reads the CPI return slot with `let (_key, data) = get_return_data().unwrap()` — it
//! DISCARDS the producer program id. Consuming return data without authenticating the
//! producer is the CPI return-data spoofing class (a real, fixed Anchor advisory). Since
//! settlement money moves on the boolean this CPI hands back, we read the return slot
//! ourselves and verify the producer before we look at a single byte.
//!
//! The types below mirror the txoracle devnet IDL (v1.5.6) exactly — field order and
//! types are the borsh wire format, so any drift breaks deserialization loudly on the
//! oracle side rather than silently here. Source: idls/txoracle.json.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{get_return_data, invoke};

use crate::errors::VerdictError;

/// The one program whose settlement verdict this program will accept. Pinned, never
/// read from a caller-supplied account.
/// [CPI SAFETY: arbitrary CPI] a constant, so a substituted program can never be invoked.
pub const TXORACLE_PROGRAM_ID: Pubkey = pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

/// Anchor discriminator for `validate_stat_v2`, from the devnet IDL.
pub const VALIDATE_STAT_V2_IX: [u8; 8] = [208, 215, 194, 214, 241, 71, 246, 178];

/// PDA seed for the oracle's per-day scores Merkle roots.
pub const DAILY_SCORES_ROOTS_SEED: &[u8] = b"daily_scores_roots";

/// TxLINE timestamps are epoch milliseconds.
pub const DAY_MS: i64 = 86_400_000;

/// Bounds on settler-supplied proof material. Real payloads for our fixture use 1 sub-tree
/// node, 1 main-tree node and 5 stat-proof nodes; 32 leaves ample headroom for deeper trees
/// while stopping a settler from heap-bombing the instruction.
pub const MAX_PROOF_NODES: usize = 32;
pub const MAX_STATS: usize = 2;

// ---------------------------------------------------------------------------
// Wire types — mirror of txoracle IDL v1.5.6
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum BinaryExpression {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

/// A Merkle-proven statistic. All three fields are inside the hashed leaf, so once the
/// oracle verifies the proof, `key`, `value` and `period` are all cryptographically bound —
/// which is what makes verdict's key and period gates trustworthy rather than advisory.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StatLeaf {
    pub stat: ScoreStat,
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

/// Exactly the payload `validate_stat_v2` expects. This is the ONLY settler-supplied input
/// to `settle` — no predicate terms, no winner, no amounts.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StatValidationInput {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub event_stat_root: [u8; 32],
    pub stats: Vec<StatLeaf>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct GeometricTarget {
    pub stat_index: u8,
    pub prediction: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum StatPredicate {
    Single {
        index: u8,
        predicate: TraderPredicate,
    },
    Binary {
        index_a: u8,
        index_b: u8,
        op: BinaryExpression,
        predicate: TraderPredicate,
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct NDimensionalStrategy {
    pub geometric_targets: Vec<GeometricTarget>,
    pub distance_predicate: Option<TraderPredicate>,
    pub discrete_predicates: Vec<StatPredicate>,
}

impl StatValidationInput {
    /// Reject oversized settler input before it reaches the heap-heavy CPI path.
    pub fn check_bounds(&self) -> Result<()> {
        require!(
            self.stats.len() <= MAX_STATS
                && self.fixture_proof.len() <= MAX_PROOF_NODES
                && self.main_tree_proof.len() <= MAX_PROOF_NODES
                && self.stats.iter().all(|s| s.stat_proof.len() <= MAX_PROOF_NODES),
            VerdictError::ProofTooLarge
        );
        Ok(())
    }

    /// The oracle keys its daily-root PDA off the proof's own `min_timestamp`; requiring
    /// `ts == min_timestamp` binds our PDA derivation to the same value the oracle uses.
    pub fn epoch_day(&self) -> Result<u16> {
        require!(
            self.ts == self.fixture_summary.update_stats.min_timestamp,
            VerdictError::InconsistentProofTimestamp
        );
        let day = self.ts.checked_div(DAY_MS).ok_or(VerdictError::Overflow)?;
        require!(
            (0..=i64::from(u16::MAX)).contains(&day),
            VerdictError::EpochDayOutOfRange
        );
        Ok(day as u16)
    }
}

// ---------------------------------------------------------------------------
// The CPI
// ---------------------------------------------------------------------------

/// Invokes `txoracle::validate_stat_v2` and returns its verdict.
///
/// Returns `Ok(true)` / `Ok(false)` when the oracle cryptographically verified the proof
/// and evaluated the predicate. Returns `Err` when the proof does not verify — so a `false`
/// (predicate did not hold) is a settlement outcome, while a bad proof reverts the whole
/// transaction. Verified empirically against devnet: a failing predicate returns `false`,
/// it does not raise `PredicateFailed` (see scripts/probe-v2-false.ts).
pub fn validate_stat_v2<'info>(
    txoracle_program: &AccountInfo<'info>,
    daily_scores_roots: &AccountInfo<'info>,
    payload: &StatValidationInput,
    strategy: &NDimensionalStrategy,
) -> Result<bool> {
    // [CPI SAFETY: arbitrary CPI / program substitution] Pin the callee BEFORE invoking.
    // Without this, a settler could pass their own program in the `txoracle_program` slot
    // and have it "validate" anything.
    require_keys_eq!(
        txoracle_program.key(),
        TXORACLE_PROGRAM_ID,
        VerdictError::UntrustedOracleProgram
    );

    // [CPI SAFETY: fake account substitution] The roots account must be genuinely owned by
    // the oracle — not a look-alike account a settler funded with forged roots.
    require_keys_eq!(
        *daily_scores_roots.owner,
        TXORACLE_PROGRAM_ID,
        VerdictError::UntrustedRootsAccount
    );

    let mut data = Vec::with_capacity(512);
    data.extend_from_slice(&VALIDATE_STAT_V2_IX);
    payload.serialize(&mut data)?;
    strategy.serialize(&mut data)?;

    let ix = Instruction {
        // The pinned constant, not the caller-supplied key — belt and suspenders with the
        // require_keys_eq above.
        program_id: TXORACLE_PROGRAM_ID,
        accounts: vec![AccountMeta::new_readonly(daily_scores_roots.key(), false)],
        data,
    };

    invoke(
        &ix,
        &[daily_scores_roots.clone(), txoracle_program.clone()],
    )?;

    // [CPI SAFETY: return-data spoofing] The runtime stamps the producing program id onto
    // the return slot and a caller cannot forge it. Authenticate the producer BEFORE
    // parsing any bytes — this is the load-bearing check that makes the boolean below
    // mean "the TxLINE oracle said so" rather than "some program said so".
    let (producer, bytes) = get_return_data().ok_or(VerdictError::OracleReturnedNothing)?;
    require_keys_eq!(
        producer,
        TXORACLE_PROGRAM_ID,
        VerdictError::SpoofedOracleReturnData
    );

    // Borsh encodes `bool` as exactly one byte, 0 or 1. Anything else is malformed; we
    // refuse to guess.
    require!(bytes.len() == 1, VerdictError::MalformedOracleReturnData);
    match bytes[0] {
        0 => Ok(false),
        1 => Ok(true),
        _ => err!(VerdictError::MalformedOracleReturnData),
    }
}
