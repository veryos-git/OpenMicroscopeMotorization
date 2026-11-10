# Microscope UI inspiration and design rules

Start with **OpenFlexure for the application structure, Nikon NIS-Elements LE for a clean everyday interface, and SharpCap for camera controls around a live image**. Use ZEN and cellSens to study how a larger application reveals tools by workflow. Use Leica LAS X for mosaic navigation, Micro-Manager for acquisition planning, and OBS for visible processing and recording state.

The recommended direction for Open Microscope Motorization is a fullscreen live image, a small set of task groups, one main overlay panel, and persistent capture and motion status. A new feature should usually become a section inside an existing task, rather than another permanent toolbar button or independent window.

## Open the research

| File | What you get |
| --- | --- |
| [Visual reference gallery](gallery.html) | 17 locally saved reference images across eight applications, task filters, source links, and notes on what to inspect. Open in a browser; no server or internet connection is needed for the images. |
| [Application comparison](01_reference_apps.md) | Which applications deserve your attention, observed UI patterns, useful ideas, and limitations. |
| [Proposed UI rules](02_ui_rules.md) | Task structure, panel rules, common controls, visual tokens, motion behavior, image processing, and capture semantics. |
| [Review exercises](03_review_exercises.md) | Concrete tasks for studying references and evaluating a future redesign. |
| [Screenshot provenance](sources.json) | Original source pages and asset URLs, dates, versions where identifiable, dimensions, and SHA-256 hashes. |
| [Screenshots](screenshots/) | Original downloaded image files and one frame extracted from an official demonstration. |

## A useful first viewing session

1. Compare OpenFlexure **View** and **Navigate**. Identify what stays fixed when controls appear.
2. Compare Nikon **Live capture layout** and **Annotation tools**. Notice the difference between permanent actions and contextual options.
3. Inspect SharpCap's regions, then the cellSens **Simple Layout demonstration**. Decide which controls your default view actually needs.
4. Inspect ZEN, Micro-Manager's acquisition dialog, and Leica's focus map only after establishing the simple everyday view.
5. Inspect OBS's filter list while designing your active-processing controls.

## Evidence and scope

Research date: **18 October 2026**. This is a public-interface study using official documentation, publisher-provided images, and an official video. Competitor source code was not inspected and competitor applications were not operated. Observations describe the pictured interface; documented behavior is linked separately. Proposed behavior for your application is identified as a proposal.

Some official pages reuse older screenshots. In particular, the Micro-Manager guide shows an early 2.0 development interface, the OpenFlexure documentation identifies revision `ac454237`, and the OBS filter example is older than the main OBS screenshot. These are references for interaction patterns, not proof of the latest appearance. Several smaller images are explicitly labeled as detail or comparison crops in the gallery.

“Clean room” here follows your meaning of studying public behavior and independently defining UI rules; it is not a formal isolated-team clean-room process. Screenshot attribution is retained in the gallery and manifest. The reference images are research material, not assets for the application's own interface.

The proposals also account for [your existing UI brief](../readme.md), [the main UI decisions](../crucial_decisions.md), [the project overview](../../../readme.md), and [the project glossary](../../../glossary.md): fullscreen live imaging, overlay tools, an explicit distinction between live and saved images, frequent actions on the first layer, precise numeric input, keyboard/gamepad control, command search, and visible changed settings. Fixed versus movable panel placement remains a design choice; the proposed default and advanced options are explained in the rules. The existing application files were not changed by this research.
