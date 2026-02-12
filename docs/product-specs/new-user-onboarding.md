# Spec: New User Onboarding

**Status:** Draft

## Goal

A new user should go from `cargo install` (or APK install) to a working
assistant in under two minutes, with zero manual config-file editing.

## User Story

> As a developer who just heard about TinyClaw, I want to run one command
> and answer a few prompts so that I have a working assistant on Telegram
> within minutes.

## Flow

1. `tinyclaw setup` launches the interactive wizard.
2. Wizard asks: which channels? → bot tokens → model → backend → heartbeat.
3. Wizard writes `.tinyclaw/settings.json`.
4. `tinyclaw start` launches everything.
5. User sends a message on the chosen channel → gets a reply.

## Acceptance Criteria

- [ ] `tinyclaw setup` completes in <60 seconds of user time.
- [ ] Invalid bot tokens are caught early with a clear error.
- [ ] `tinyclaw start` prints a single confirmation line with the listening
      port and enabled channels.
- [ ] First response arrives within 30 seconds of sending a message.

## Open Questions

- Should the wizard offer to download the model (`tinyclaw pull`) automatically?
- Should we validate the bot token by making a test API call during setup?
