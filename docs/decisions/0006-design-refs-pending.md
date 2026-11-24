# 0006 Design reference images are pending
- Context: The design spec names a "Stash: key screens" canvas with five frames at 1440 px (browse, loop page, kit page, upload, profile) to export into docs/design/refs/. The canvas was not included with the document.
- Options: Wait for the export; have the Interface lane mock the five screens first.
- Choice: docs/design/refs/ is created and empty. Ticket 131 cannot start until the owner exports the frames there, or approves a mockup ticket instead.
- Reason: The playbook's first design practice is a visual target before any UI code.
- Consequence: Interface tickets that draw screens (132 onward) are blocked on this.
