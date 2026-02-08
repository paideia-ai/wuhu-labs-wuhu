# Request Cycle Model (Self-Contained)

## Purpose
Define a deterministic transformation from a backend event list into a structured model for UI and analysis.

## 1. Input Model (Wire Format)
The backend emits an ordered list of events.

Each event is one of:
- `user-message`
- `agent-output` (assistant text, reasoning text, tool call)
- `tool-result`
- `run-stop` (agent is sent to idle)

`run-stop` always has a reason:
- `completed`
- `interrupted`
- `error`

## 2. Boundary Rule
`completed`, `interrupted`, and `error` are the same **boundary delimiter class** for state transitions: each closes the current active run and returns agent state to idle.

They differ only by semantic reason.

## 3. User Message Kinds
A user message is classified as:
- `direct`: sent while agent is idle.
- `steer`: sent while agent is active and intended to influence the current run.
- `followUp`: sent while agent is active but queued to run after current non-steer work ends.

## 4. Queue Semantics
- `followUp` is queued-next non-steer work.
- `steer` is in-run feedback, not queued-next root work.

## 5. RequestCycle
A **RequestCycle** (aka **ResolutionCycle**) is:
- exactly one root non-steer user message (`direct` or promoted `followUp`),
- plus all related agent work,
- plus any steer feedback applied during that work,
- ending at first `run-stop` (`completed | interrupted | error`),
- excluding the next root non-steer message.

## 6. Two Views Inside a RequestCycle

### 6.1 InferenceLoop View (Model-Serving View)
Represents how the model is served:
1. model receives input context,
2. model emits output (assistant/reasoning/tool calls),
3. system feeds back tool results and optional steer,
4. repeat until `run-stop`.

Atomic unit name: **InferenceRound**.

### 6.2 ResolutionStep View (UI/Product View)
Normalize each RequestCycle into a step list.

Step types:
- `non-steer` user step (root request)
- `steer` user step
- `ai-block` step

`ai-block` contains:
- exactly one AI text item: `assistant` or `reasoning` (no merging),
- grouped tool calls.

Tool grouping rules (adjacent tool calls):
- `read-group`: `ls`, `read`, `grep`, `find`
- `write-group`: `write`, `edit`
- `bash-group`: `bash`
- `other-group`: anything else

`tool-result` handling:
- not rendered as independent steps,
- either ignored in this view or attached to corresponding tool call metadata.

## 7. Deterministic Construction (State Machine)
State: `idle` or `active`.

1. Start in `idle`.
2. On user message in `idle`: classify `direct`, open new RequestCycle, move to `active`.
3. While `active`:
   - classify incoming user message as `steer` or `followUp` by policy/context,
   - append AI output and tool activity to current cycle.
4. On `run-stop` (`completed | interrupted | error`): close current cycle, move to `idle`.
5. If a `followUp` is queued, it becomes the next cycle root immediately.

With ordered events and guaranteed `run-stop`, this projection is deterministic.
