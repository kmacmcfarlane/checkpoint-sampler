## Interactive mode — commit and merge policy

You are running in interactive mode with a human operator present.

- Do NOT commit until the user has reviewed and explicitly approved the changes.
- Do NOT merge the feature branch into main until the user gives explicit approval.
- Do NOT set `status: done` in /agent/backlog.yaml until the user confirms completion.
- When the story's DoD is met (including code review and QA approval), present a summary of changes and a suggested commit message. Then wait for the user to approve before proceeding.
