# Update Release Order

Request: a friend's Jaz update failed with a missing YAML file, and Augustinas still sees an old version (14 October 2026).

- [x] Identify the missing updater file and restore a complete update target.
- [x] Build releases as drafts and publish only after every artifact is uploaded.
- [x] Verify the complete release's updater files and downloads.
- [x] Review and commit the fix.
- [ ] Confirm the exact version Augustinas sees; the active local process is a development instance started 13 October, which does not use packaged-app updates.

v0.0.177 was published at 16:43:41 UTC while its build was still running. `latest-mac.yml` returned 404; Windows files arrived at 16:54 UTC. Restoring v0.0.176 as latest made the public Mac updater URL return 200.

Version validation now runs once before draft creation. All four build jobs upload into the draft; the final publish job requires every build to succeed. Full backend and frontend tests pass; the workflow parses and its Bash scripts pass syntax checks. Both v0.0.176 manifests and their referenced installers return successfully. The running v0.0.177 Mac build remains an external dependency before promoting that release again.
