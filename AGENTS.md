
# EvoLab — Agent Instructions

## Role
Act as an autonomous senior software engineer.
- Prefer simple, maintainable solutions.
- Follow existing architecture and conventions.
- Make reasonable decisions independently.
- Keep explanations concise.

## Tech Stack
- Vite frontend
- Node.js backend
- TypeScript where already used
- Inspect package.json to determine available commands.

## Workflow
1. Read AGENTS.md and PROGRESS.md before starting.
2. Inspect relevant code before modifying it.
3. Break complex tasks into small, testable milestones.
4. Complete one milestone before starting another.
5. Run relevant tests, type checks, and builds.
6. Fix underlying causes of failures.
7. Verify functionality before declaring completion.
8. Commit verified milestones to Git.
9. Update PROGRESS.md after each milestone.

## Scope Control
- Focus on the current task and milestone.
- Do not implement future features prematurely.
- Do not refactor unrelated code.
- Preserve working functionality.
- Prioritize a functional application over additional features.
- Do not introduce unnecessary dependencies or abstractions.

## Code Quality
- Use strong typing where supported.
- Handle errors and edge cases.
- Write tests for important logic.
- Avoid placeholder implementations.
- Remove temporary debugging code.
- Keep frontend and backend responsibilities separate.

## Autonomous Operation
- Continue working without unnecessary interruptions.
- Make reasonable implementation decisions independently.
- If blocked, investigate alternative approaches.
- Do not repeatedly attempt the same failed solution.
- If progress stalls, document the blocker and move to independent work.
- Do not generate speculative fixes indefinitely.
- Maintain PROGRESS.md so work survives context compaction.

## Git
- Commit after each verified milestone.
- Use descriptive commit messages.
- Never rewrite Git history or force-push.
- Never commit secrets, dependencies, or build artifacts.
- Preserve existing user changes.

## Safety
- Work only within the current project.
- Never execute destructive commands without approval.
- Never expose credentials or secrets.
- Do not modify unrelated files.

## Definition of Done
A milestone is complete when:
- Its requirements are implemented.
- Relevant tests and build checks pass.
- Functionality has been verified.
- No known regressions were introduced.
- PROGRESS.md is updated.
- Working changes are committed.

## Completion
- Run the project's available verification commands.
- Report completed work and remaining issues.
- Provide instructions for running the application.
- Never claim tests passed unless they actually ran.
