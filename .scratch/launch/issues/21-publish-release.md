# 21: Publish the verified release

**What to build:** After explicit owner authorization and successful GNOME 49/50 QA, tag the verified commit, create release notes, and submit the exact tested artifact to the intended distribution channels.

**Blocked by:** 20 (GNOME 49/50 release QA).

**Status:** blocked-awaiting-owner-authorization

- [ ] Repository owner explicitly authorizes the tag and each external publication target
- [ ] The tag points to the exact commit and artifact verified in QA
- [ ] Release notes include user-visible changes, privacy/retention behavior, supported Shell versions, configuration requirements, and known limitations
- [ ] The uploaded GNOME Extensions artifact matches the locally verified package checksum
- [ ] Publication status and URLs are recorded without modifying or closing unrelated issues
