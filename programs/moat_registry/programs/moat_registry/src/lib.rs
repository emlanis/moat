use anchor_lang::prelude::*;

declare_id!("FTVm8gDndxnocAqi4sr53BnaymMXxESNGHgTzagJX2qY");

#[program]
pub mod moat_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.admin = ctx.accounts.authority.key();
        state.next_id = 0;
        state.bump = ctx.bumps.state;
        Ok(())
    }

    pub fn register_entry(
        ctx: Context<RegisterEntry>,
        target_program: Pubkey,
        kind: u8,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require_keys_eq!(state.admin, ctx.accounts.authority.key(), MoatError::Unauthorized);

        let entry_id =
            u32::try_from(state.next_id).map_err(|_| MoatError::NextIdOverflow)?;
        let entry = &mut ctx.accounts.entry;
        entry.registry = state.key();
        entry.id = entry_id;
        entry.admin = ctx.accounts.authority.key();
        entry.target_program = target_program;
        entry.kind = kind;
        entry.bump = ctx.bumps.entry;

        state.next_id = state
            .next_id
            .checked_add(1)
            .ok_or(MoatError::Overflow)?;

        Ok(())
    }

    pub fn commit_batch(
        ctx: Context<CommitBatch>,
        merkle_root: [u8; 32],
        memo_hash: [u8; 32],
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require_keys_eq!(state.admin, ctx.accounts.authority.key(), MoatError::Unauthorized);

        let commit = &mut ctx.accounts.commit;
        commit.id = state.next_id;
        commit.admin = state.admin;
        commit.merkle_root = merkle_root;
        commit.memo_hash = memo_hash;
        commit.created_at = Clock::get()?.unix_timestamp;

        state.next_id = state
            .next_id
            .checked_add(1)
            .ok_or(MoatError::Overflow)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + RegistryState::INIT_SPACE,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, RegistryState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterEntry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump
    )]
    pub state: Account<'info, RegistryState>,

    #[account(
        init,
        payer = authority,
        space = 8 + RegistryEntry::INIT_SPACE,
        seeds = [
            b"entry",
            state.key().as_ref(),
            &state.next_id.to_le_bytes()[..4]
        ],
        bump
    )]
    pub entry: Account<'info, RegistryEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitBatch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"state"],
        bump = state.bump
    )]
    pub state: Account<'info, RegistryState>,

    #[account(
        init,
        payer = authority,
        space = 8 + BatchCommit::INIT_SPACE,
        seeds = [
            b"commit",
            state.key().as_ref(),
            &state.next_id.to_le_bytes()
        ],
        bump
    )]
    pub commit: Account<'info, BatchCommit>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct RegistryState {
    pub admin: Pubkey,
    pub next_id: u64,
    pub bump: u8,
}
impl Space for RegistryState {
    const INIT_SPACE: usize = 32 + 8 + 1;
}

#[account]
pub struct RegistryEntry {
    pub registry: Pubkey,
    pub id: u32,
    pub admin: Pubkey,
    pub target_program: Pubkey,
    pub kind: u8,
    pub bump: u8,
}
impl Space for RegistryEntry {
    const INIT_SPACE: usize = 32 + 4 + 32 + 32 + 1 + 1;
}

#[account]
pub struct BatchCommit {
    pub id: u64,
    pub admin: Pubkey,
    pub merkle_root: [u8; 32],
    pub memo_hash: [u8; 32],
    pub created_at: i64,
}
impl Space for BatchCommit {
    const INIT_SPACE: usize = 8 + 32 + 32 + 32 + 8;
}

#[error_code]
pub enum MoatError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Next id overflow")]
    NextIdOverflow,
    #[msg("Overflow")]
    Overflow,
}
