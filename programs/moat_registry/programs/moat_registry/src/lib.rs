use anchor_lang::prelude::*;

declare_id!("FTVm8gDndxnocAqi4sr53BnaymMXxESNGHgTzagJX2qY");

#[program]
pub mod moat_registry {
    use super::*;

    pub fn commit_batch(
        ctx: Context<CommitBatch>,
        batch_id: u64,
        merkle_root: [u8; 32],
        memo_hash: [u8; 32],
        kind: u8,
    ) -> Result<()> {
        let batch = &mut ctx.accounts.batch;
        if batch.creator != Pubkey::default() {
            return err!(MoatError::BatchAlreadyExists);
        }

        batch.creator = ctx.accounts.creator.key();
        batch.batch_id = batch_id;
        batch.kind = kind;
        batch.merkle_root = merkle_root;
        batch.memo_hash = memo_hash;
        batch.created_at = Clock::get()?.unix_timestamp;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(batch_id: u64)]
pub struct CommitBatch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init_if_needed,
        payer = creator,
        space = 8 + BatchCommit::INIT_SPACE,
        seeds = [
            b"batch",
            creator.key().as_ref(),
            &batch_id.to_le_bytes()
        ],
        bump
    )]
    pub batch: Account<'info, BatchCommit>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct BatchCommit {
    pub creator: Pubkey,
    pub batch_id: u64,
    pub kind: u8,
    pub merkle_root: [u8; 32],
    pub memo_hash: [u8; 32],
    pub created_at: i64,
}
impl Space for BatchCommit {
    const INIT_SPACE: usize = 32 + 8 + 1 + 32 + 32 + 8;
}

#[error_code]
pub enum MoatError {
    #[msg("Batch already exists for this creator")]
    BatchAlreadyExists,
}
