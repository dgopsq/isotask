# Changelog

## [0.1.2](https://github.com/dgopsq/isotask/compare/0.1.1...0.1.2) (2026-09-11)


### Bug fixes

* clear Obsidian review bot warnings ([#16](https://github.com/dgopsq/isotask/issues/16)) ([ff09094](https://github.com/dgopsq/isotask/commit/ff0909430d9c9a708ddac6021404a84055676978))
* **css:** drop :has, display: contents and column-gap flagged by the review bot ([#18](https://github.com/dgopsq/isotask/issues/18)) ([863454e](https://github.com/dgopsq/isotask/commit/863454ea352054711bb1bdf94585110ef00c3327))


### Maintenance

* sync versions.json for 0.1.1 ([431256d](https://github.com/dgopsq/isotask/commit/431256d4e2462b10f7b1bc0e45c40dc8cd9ff85a))

## [0.1.1](https://github.com/dgopsq/isotask/compare/0.1.0...0.1.1) (2026-09-11)


### Bug fixes

* **e2e:** poll for the spawned occurrence's body instead of reading once ([#12](https://github.com/dgopsq/isotask/issues/12)) ([be690c0](https://github.com/dgopsq/isotask/commit/be690c08f483e6d055614ccb888e6c1726f32242))
* **release:** drop sticky release-as, list chores in changelog ([#14](https://github.com/dgopsq/isotask/issues/14)) ([c89a873](https://github.com/dgopsq/isotask/commit/c89a8737bdaf451d74735d0a4bff332aa8d95f70))


### Maintenance

* rename plugin to Isotask ([#11](https://github.com/dgopsq/isotask/issues/11)) ([4860b9e](https://github.com/dgopsq/isotask/commit/4860b9ec77564e31de7dfa1402f0b5668339664e))

## [0.1.0](https://github.com/dgopsq/isotask/compare/0.1.0...0.1.0) (2026-09-11)


### ⚠ BREAKING CHANGES

* **priority:** rebuild priority as normal/high/urgent with Apple-style marks

### Features

* **adapters,settings:** VaultTaskStore over vault/metadataCache/processFrontMatter; configurable statuses + property keys with StatusesModal ([3d2d597](https://github.com/dgopsq/isotask/commit/3d2d5973b14a0b43cdd3e9c43566348a23a29b4d))
* **app:** add setPriority, setProject and setTags use-cases ([d85d58b](https://github.com/dgopsq/isotask/commit/d85d58b6443f68c875ca8307db94365f47d96633))
* **app:** rescheduleTask use-case for calendar drag and resize ([546c8c8](https://github.com/dgopsq/isotask/commit/546c8c812bfacc27b5a0c9a02f046e53f9d1f831))
* **app:** use-cases — set/cycle status with recurrence spawn, create task, convert note, set date/duration/recurrence, generate base (fake-port tests) ([74ef834](https://github.com/dgopsq/isotask/commit/74ef83498c50781b64a642c148ead9da26f42bdd))
* **bases:** route the toolbar's New/+ into the create-task modal ([f045f4c](https://github.com/dgopsq/isotask/commit/f045f4cd24f5aeecdc385fbc099f213665707aa1))
* **calendar:** 3-day view and compact chrome on narrow panes ([d307a0e](https://github.com/dgopsq/isotask/commit/d307a0e40de09433971f461305e92ba17b13bb8d))
* **calendar:** bring month back on narrow panes as a dot grid ([3faf2fb](https://github.com/dgopsq/isotask/commit/3faf2fbed1f3e22020957a0f3641d4e48218b898))
* **calendar:** compact hourly time grid ([a7d2179](https://github.com/dgopsq/isotask/commit/a7d2179a1112ffd5c701dca2cd709d95854c4d1e))
* **calendar:** drop the list view ([9d24f6d](https://github.com/dgopsq/isotask/commit/9d24f6d479de7fc693d7003a3b9e3f377c536195))
* **calendar:** Event Calendar adapter implementing CalendarRenderer ([ce515d3](https://github.com/dgopsq/isotask/commit/ce515d3fdde54ff2053dcefdd9699ffee85dd692))
* **calendar:** map Event Calendar drops back to task dates ([47c9558](https://github.com/dgopsq/isotask/commit/47c95586fdca74ff1acc9875a6264a38668c209a))
* **calendar:** open on click, reschedule on drag, create on slot click ([ec9cd87](https://github.com/dgopsq/isotask/commit/ec9cd87f132e4ed97306951a9fed44c782565129))
* **calendar:** render the all-day chip time as a separate muted label ([4ccee2a](https://github.com/dgopsq/isotask/commit/4ccee2ab9652e7d8c49d6f7cb3873f5a528315b7))
* **calendar:** render zero-duration events as all-day chips ([f1f03c5](https://github.com/dgopsq/isotask/commit/f1f03c570622fe9da6a3390f7b3d3944b3844dc3))
* **calendar:** undo and redo a reschedule with Cmd+Z ([eaa7962](https://github.com/dgopsq/isotask/commit/eaa7962a0656d2c3aa400c73f90e8c4382faaf92))
* **calendar:** wire Event Calendar adapter into isotask-calendar Bases view ([d70e58e](https://github.com/dgopsq/isotask/commit/d70e58e049b89dcddd12b45cd03b133fddec4efc))
* **calendar:** wire Interaction — drag, resize and slot click ([866dc09](https://github.com/dgopsq/isotask/commit/866dc09ae951b16e8c80f3df89c962c010f1a201))
* **domain:** bucket sort option — completed tasks at bottom ([324a108](https://github.com/dgopsq/isotask/commit/324a108d9abd9e106d154b5dcbf499e017fb6de9))
* **domain:** calendar event derivation from due/scheduled ([3051dcd](https://github.com/dgopsq/isotask/commit/3051dcda28c3cbe2189a5c2eb5745b28f405fd1d))
* **domain:** calendar view-options parsing ([00ff56e](https://github.com/dgopsq/isotask/commit/00ff56e234756561f67bf61231bdea22ab90bc49))
* **domain:** default a missing status to the first open status ([29cddf5](https://github.com/dgopsq/isotask/commit/29cddf52bd1837f2b5c1aab102d2944e5380eb81))
* **domain:** feed row date anchor + view-options parsing ([19ff3ed](https://github.com/dgopsq/isotask/commit/19ff3ed5cc39316a155f1963e339acd084b3319d))
* **domain:** lenient parse with canonicalize fixes (ADR 0010) ([febd2a9](https://github.com/dgopsq/isotask/commit/febd2a9799112b6a7a7b0fc6daceb99d7f3f87e0))
* **domain:** result/option, branded dates, task types, statuses, frontmatter parser, feed buckets (101 tests) ([d8f5216](https://github.com/dgopsq/isotask/commit/d8f52169e99e629b39c3ccbc441a76c72c88f4e8))
* **domain:** RRULE recurrence (rrule, floating time), status transitions with recurrence spawn plan (61 tests) ([9137eb7](https://github.com/dgopsq/isotask/commit/9137eb7635e738e8edbf546c197e9ad2241be68e))
* **domain:** withDatePart and differenceInMinutes date helpers ([5965b42](https://github.com/dgopsq/isotask/commit/5965b42e88cc8b754a98bbf7b73440745aa4186b))
* **e2e:** E2E_GREP for targeted single-test debug runs ([bf9873c](https://github.com/dgopsq/isotask/commit/bf9873c74f83dade948e898926bd08bd55bdd17e))
* **feed:** collapse rows to two lines on narrow panes ([b293a8f](https://github.com/dgopsq/isotask/commit/b293a8f41df1c34567002572cf5da9f5ff96a837))
* **feed:** color the project label, drop the leading dot ([#4](https://github.com/dgopsq/isotask/issues/4)) ([78bcda9](https://github.com/dgopsq/isotask/commit/78bcda9896b7e474324c1abcd64b618eb1f3b3e9))
* **feed:** date chip opens DateModal, dispatches setDate ([52a8457](https://github.com/dgopsq/isotask/commit/52a8457aed1cee11df33d3dc222602443d5418e5))
* **feed:** drive row chips from the Bases toolbar's Properties menu ([bf3ca88](https://github.com/dgopsq/isotask/commit/bf3ca88661b34469d87645a296f992347cff93c9))
* **feed:** full row layout (priority/project/tags), bucket/view-option wiring ([48b18e3](https://github.com/dgopsq/isotask/commit/48b18e368ed1f187ef4343822a70f2faef691045))
* **feed:** lay rows out as aligned grid columns via subgrid ([6166d52](https://github.com/dgopsq/isotask/commit/6166d5221e68297a3610ed097b17c41d26608114))
* **feed:** make the priority chip a picker and add a row context menu ([eb221a8](https://github.com/dgopsq/isotask/commit/eb221a8817162999136b98afbef9d451b4084108))
* **feed:** widen group spacing and gather invalid rows under Errors ([9bf575f](https://github.com/dgopsq/isotask/commit/9bf575f1e036f27de2efa0e93e9b960f4f4dccf6))
* **note:** add missing edit commands and an edit-task header action ([982ecb4](https://github.com/dgopsq/isotask/commit/982ecb425bde5bffc68113206679bdd651026b8d))
* **panel:** add ribbon icon and one-time first-enable auto-open ([cd1c803](https://github.com/dgopsq/isotask/commit/cd1c8036f5282a786fa07d62737c25a9ca0336bb))
* **panel:** add sidebar task panel with safe field editing ([056d7bc](https://github.com/dgopsq/isotask/commit/056d7bca26025c30d6be3b9d80a713f8571577b4))
* **ports,adapters:** port interfaces; Obsidian clock, notifier, settings parsing, Bases entries mapping ([6b86cf6](https://github.com/dgopsq/isotask/commit/6b86cf601e7fa62f43e82617e55c2052e6a1cfad))
* **priority:** rebuild priority as normal/high/urgent with Apple-style marks ([7790e78](https://github.com/dgopsq/isotask/commit/7790e78804fb6054ea34236b76efa7cd05a82f87))
* **project:** add project color picker (feed menu, task panel, command) ([fb99724](https://github.com/dgopsq/isotask/commit/fb997247caa225801f38ae36d5a8515b72e92bff))
* **project:** project colors drive the card dot and bar ([39332f7](https://github.com/dgopsq/isotask/commit/39332f7a558641ea33478b63ec23669479eda386))
* require Obsidian 1.13, adopt declarative settings API (ADR 0009) ([7d443aa](https://github.com/dgopsq/isotask/commit/7d443aa304bd3e069c9217bc067aa241851eb7f0))
* subtle interaction animations (feed FLIP moves, hover/press/drag transitions) ([#2](https://github.com/dgopsq/isotask/issues/2)) ([f2045e3](https://github.com/dgopsq/isotask/commit/f2045e3daf1bf42a775440faca7dabf6d43ced76))
* two-state tasks — feed checkbox toggle, open/done kinds only ([#3](https://github.com/dgopsq/isotask/issues/3)) ([4d60b55](https://github.com/dgopsq/isotask/commit/4d60b552657c5f0bad33bfc95857141ad866d1ce))
* **ui,commands:** create-task/date/recurrence/status modals, 10 commands, file-menu status items, feed status menu ([b023804](https://github.com/dgopsq/isotask/commit/b023804a20537fedc81d0be175808378e7cf9260))
* **ui:** add priority menu, project/tags/duration modals and a unified task-edit menu ([be69e3e](https://github.com/dgopsq/isotask/commit/be69e3e80700ce37ce229dd04c1e0f15e56f844f))
* **ui:** descriptions on every setting row (Obsidian 1.13 top-aligns rows without one) ([65af779](https://github.com/dgopsq/isotask/commit/65af77927b19c8c0b47e25a4fd07a2057fbec8a2))
* **ui:** note/folder/tag/icon suggesters for modal inputs ([8c4ddfb](https://github.com/dgopsq/isotask/commit/8c4ddfb7919bd806c908fc3c29b3e494c970cc9c))
* **ui:** shorter create-task modal — Title/Due/Priority/Repeat by default, More options fold, clock toggle on date rows ([32ac406](https://github.com/dgopsq/isotask/commit/32ac406e886fed93c9760d51c3c1a7e78ac9f227))
* **views:** minimal isotask-feed and isotask-calendar Bases views, settings tab, plugin entry ([fb8554c](https://github.com/dgopsq/isotask/commit/fb8554c9f9ae2c74369dc8a24859d292bc376f3c))


### Bug Fixes

* **bases:** self-heal the first-render metadataCache race ([5e45ea5](https://github.com/dgopsq/isotask/commit/5e45ea5d9f62cfe3c54ca880c146d4abe13cc426))
* **calendar:** all-day chips stay single-line everywhere; compact hides the time label ([203897c](https://github.com/dgopsq/isotask/commit/203897cee0519de27332f5d75e1aa3c814e44ffd))
* **calendar:** center events in their grid track via justify-self ([b04e01a](https://github.com/dgopsq/isotask/commit/b04e01a669a0a4b68e55ffa82a98d2f4393bdd7f))
* **calendar:** center events inside the library's column gap ([4923b6a](https://github.com/dgopsq/isotask/commit/4923b6a24a0a79b0513fd95a412aed33310611e4))
* **calendar:** compact-month pills span the full cell, mark at the right edge ([f367f86](https://github.com/dgopsq/isotask/commit/f367f86e6f209fd64c3d0e3b05ad5227fc025932))
* **calendar:** don't resurrect a deleted task on click ([b45ebb3](https://github.com/dgopsq/isotask/commit/b45ebb30b7a1385fe7fd2b1f96932434ce229576))
* **calendar:** draw the block priority bar as an inset pill instead of a border ([7c71f6e](https://github.com/dgopsq/isotask/commit/7c71f6e823dd256b6aa6fb4809072cd8366108e9))
* **calendar:** drop the corner mark on sliver-width overlap blocks ([f0e897c](https://github.com/dgopsq/isotask/commit/f0e897ccd47f10fbef09d699261e27fbee94e162))
* **calendar:** ease event type scale back up to 0.92em ([4882f32](https://github.com/dgopsq/isotask/commit/4882f3289ff278ebfb304c2356c62bffed218063))
* **calendar:** hide the time line in blocks too short to fit it ([8e448ce](https://github.com/dgopsq/isotask/commit/8e448cea7710b9e340e02a71d405ee5b1422b3eb))
* **calendar:** keep Cmd+Z armed after a drag ([88c244f](https://github.com/dgopsq/isotask/commit/88c244fcd89b9bdd046b0e2e9b5523742e09b0a8))
* **calendar:** keep compact-month pills full-width under justify-self centering ([ce1c730](https://github.com/dgopsq/isotask/commit/ce1c7302a7ed2f9f1d64f538acc814bf8feb4faf))
* **calendar:** keep the user's toolbar view across data updates ([34eb5aa](https://github.com/dgopsq/isotask/commit/34eb5aaf7ff1b21dce30023c1cc18f3f93055bd5))
* **calendar:** list every toolbar button label — EC replaces the buttonText map ([fcc7e6b](https://github.com/dgopsq/isotask/commit/fcc7e6bc3862ff66e6d1bf0eaa02b4c08df45d8a))
* **calendar:** optical +2px inline-start padding on chips and compact pills ([c3a605e](https://github.com/dgopsq/isotask/commit/c3a605e03e92cd2cd1e1dbdcf8edeb14368242ac))
* **calendar:** revert a drop whose event fell out of the id map ([ec51d90](https://github.com/dgopsq/isotask/commit/ec51d904cd5ae77510b7164dc172cf0d7a9af19d))
* **calendar:** shrink hour-axis and all-day labels one step ([f9d3cb4](https://github.com/dgopsq/isotask/commit/f9d3cb4653779577655aab5a0c976e1085a57aa2))
* **calendar:** shrink the compact time gutter from 72px to 28px ([e2a9bad](https://github.com/dgopsq/isotask/commit/e2a9bad0a4ea78de00aaea01a754aa3db80aef15))
* **calendar:** single-line events, compact-month pills, smaller event type ([0474c59](https://github.com/dgopsq/isotask/commit/0474c594d2e743cc30b30ff69375bc060eca6ef0))
* **calendar:** size the drag preview identically to real timed blocks ([8b6cf9f](https://github.com/dgopsq/isotask/commit/8b6cf9fa1ead85ee041cb047c6602459ec4f57fa))
* **calendar:** sort calendar events by start before rendering ([6942c36](https://github.com/dgopsq/isotask/commit/6942c3611a23fb26e324abf858e11f9e14008f18))
* **calendar:** stack time above title on compact chips ([ebfeaa7](https://github.com/dgopsq/isotask/commit/ebfeaa72b63463d6e9408d69f464473c2ae34646))
* **calendar:** stop centering time-grid events; overlap groups overflowed ([1ac6f79](https://github.com/dgopsq/isotask/commit/1ac6f797937368dcd563f499c91c37fa9f291858))
* **domain:** cycle status in configured order, not alphabetical id order ([eb8a582](https://github.com/dgopsq/isotask/commit/eb8a582315e46afb2433edfec5f6ada77b471d7e))
* **e2e:** stabilise calendar drag tests in CI; framed dark README screenshots ([#7](https://github.com/dgopsq/isotask/issues/7)) ([765588c](https://github.com/dgopsq/isotask/commit/765588c8878a538531d6fc84d2750d2f4683f185))
* **feed:** cap wide metadata cells and floor the title track ([fd45843](https://github.com/dgopsq/isotask/commit/fd45843d96a10630a819722eafa25d7a884e2132))
* **feed:** honor the Bases toolbar sort within feed buckets ([035a84f](https://github.com/dgopsq/isotask/commit/035a84f6b12ca01fd7eb05a4f7dfd0d6e2b04e48))
* **feed:** keep an empty priority grid cell for normal-priority rows ([021bb59](https://github.com/dgopsq/isotask/commit/021bb599e8e19b2cc35c254c8c50f04f88d8d0db))
* **feed:** scope row DOM listeners to a per-render child component ([ce30f72](https://github.com/dgopsq/isotask/commit/ce30f72c390c949aae3051a14b6737f6b5f294f9))
* **feed:** show falsy generic chip values, hide Bases null values ([14403c9](https://github.com/dgopsq/isotask/commit/14403c96866b6364c089bb99621d1a38e604a360))
* **feed:** suppress Android double context menu, describe parse errors with allowed values ([271ad80](https://github.com/dgopsq/isotask/commit/271ad809f5572c376fed09b362437ed7c2603cec))
* **panel:** survive rename/delete of the followed note ([ba442ed](https://github.com/dgopsq/isotask/commit/ba442edf41b7c26fa2831ccd0c89d1f85f077a75))
* **project:** repaint stale hex dots, harden color modal, refresh panel swatch ([e41c03e](https://github.com/dgopsq/isotask/commit/e41c03e4e3a3d4482c013d85ebee4e60cf7d739e))
* **release:** bare version tags, changelog from all commits ([#9](https://github.com/dgopsq/isotask/issues/9)) ([440cbf2](https://github.com/dgopsq/isotask/commit/440cbf29f133625675c625a6ea69709dc20d91bf))
* **ui:** shorter row descriptions so they stay on one line ([a40dafa](https://github.com/dgopsq/isotask/commit/a40dafa8920294be2dc1442dae950010bc755f47))
* **views:** metadataCache "resolved" refresh fires once and guards missing data ([4e103f9](https://github.com/dgopsq/isotask/commit/4e103f9ffdb1194a2d6bffe935e6ad966fc02df7))
