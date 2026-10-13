# Configured Bots Review

Four findings repaired. The declaration code resolves names and validates schedules before applying domain operations; runtime model control remains in ACP.

| Before | After |
| --- | --- |
| A later saved-name conflict could reject config after an earlier bot was created. | Build a validated declaration plan before writes; ambiguity tests verify no partial creation. |
| Duplicate validation used lowercase keys while lookup used Unicode case folding. | Both use `EqualFold`; long-s and final-sigma duplicates are rejected. |
| Declarations ran before binding HTTP, including model changes that can resume an agent using Jaz MCP. | Bind and serve before declarations; failed declarations close HTTP and the agent manager. Real lifecycle tests cover occupied ports and rejected schedules. |
| A combined prompt/model update resumed the agent before saving its new prompt. | Save the bot definition before model control; the actual resume resolver receives the new instructions. |

The before-review code fails the corresponding regression controls. The full Go 1.26 backend suite passes; staticcheck retains its existing 50 findings. No dependency, ACP protocol or authentication changes were introduced.
