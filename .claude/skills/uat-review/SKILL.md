---
name: uat-review
description: Walk through backlog items in UAT status to approve or provide feedback. Use when user says "uat review", "review uat", "approve tickets", or "uat feedback".
disable-model-invocation: true
allowed-tools: "Read, Write, Grep, AskUserQuestion, Edit"
---

# UAT Review

Review backlog stories that are in `uat` status, one at a time, letting you approve or provide feedback.

## Instructions

### Step 1: Read the backlog

Read `/agent/backlog.yaml` and collect all stories where `status: uat`.

If no stories are in `uat` status, tell the user there are no items to review and stop.

### Step 2: Walk through each UAT story

For each story in `uat` status, present it to the user using the `AskUserQuestion` tool:

- **question**: Include the story ID, title, and a brief description derived from the `notes` field (first 1-2 sentences). If there is no `notes` field, use the first acceptance criterion instead. Format: `[{id}] {title} — {brief description}`
- **header**: Use the story ID (e.g. "B-023")
- **options**:
  1. Label: "Approve", Description: "Move this story to done"
  2. Label: "Feedback", Description: "Provide UAT feedback for rework"
  3. Label: "Skip", Description: "Leave in UAT for now, review later"

Present ALL UAT stories in a single AskUserQuestion call (one question per story, up to 4 at a time). If there are more than 4, batch them into groups of 4.

### Step 3: Apply feedback first

For each story the user provided feedback on:

- **Feedback**: The user will have typed feedback in the "Other" field or selected "Feedback". If they selected "Feedback", ask a follow-up question to collect the feedback text. Then edit `backlog.yaml` to add `uat_feedback: |` with their feedback text under that story (at the same indentation level as `status`, `title`, etc.). Do NOT change the status — the orchestrator handles status transitions based on `uat_feedback`.

### Step 4: Move approved stories to backlog_done.yaml

For each approved story:

1. Edit `backlog.yaml` to change `status: uat` to `status: done` for that story.
2. Read the full story block from `backlog.yaml` (everything from `- id:` to the next story or end of file).
3. Remove any `metrics:` block and its children from the story content.
4. Append the story to the end of `/agent/backlog_done.yaml` under the `stories:` list.
5. Remove the entire story block from `backlog.yaml`.

When appending to `backlog_done.yaml`, read the end of the file first to find the correct insertion point. Append after the last story entry.

### Step 5: Handle skipped stories

- **Skip**: Do nothing for that story.

### Step 6: Summary

After processing all responses, show a summary of actions taken:
- Which stories were approved (moved to done in backlog_done.yaml)
- Which stories received feedback (uat_feedback added)
- Which stories were skipped

### Step 7: Repeat if needed

If there were more than 4 UAT stories and not all have been presented yet, continue with the next batch.

## Important

- Do NOT change any field other than `status` (for approvals) or add `uat_feedback` (for feedback).
- Preserve exact YAML formatting and indentation when editing both files.
- The `uat_feedback` field should be added at the same indentation level as `status`, `title`, etc.
- For approvals, set `status: done` directly. This is the one case where `done` is set — by the user through this skill.
- Process feedback additions BEFORE moving approved stories, to avoid editing stories that have already been removed.
