# workflow

this document describes the workflow of the operator

Problem IDs (`WF-001`–`WF-013`) match [workflow_summary.md](workflow_summary.md).
IDs remain stable when priorities, status, or document order change. Repeated
mentions share an ID; new problems receive the next unused number. See the
summary for implementation status and suggested priorities.

# gloassry 

## assembly 
is a USB camera + esp32 that has 2-3 stepper motors byj 48 with ULN drivers + the software 

## stepper motor
a simple stepper motor, in this case 28BYJ-48 stepper motor
##  usb cam
the usb camera that is connected to the microscope
## operator 
the person / the user that uses the assembly


# workflow and potential problems
this section descirbes what problems can happen while the operator is using the assembly, there is also a possible solution provided
there are priorities listed 

## connection
a operator connects the assembly

problem:
- **WF-001 — Camera discovery:** the usb Camera does not show up and the operator does not know where to connect it digitally
- **WF-002 — Controller connection / no movement:** the motors do not move at all
- **WF-004 — Accessible motor speed:** the motors are set to slowly 

possible solution: 
the UI has to indicate clearly if something is connected or not, maybe there should be something like a checklist that goes through all steps and also displays helpful messages. 

### WF-002 — Motors do not move

problem: 
the operator tests the motors but they dont move
possible solution: 
the UI provides a pop help text with hardware actions to take for the operator so that it can be ensure that the hardware connection is there 

### WF-003 — Firmware recovery

possible solution:
the UI provides a easy way to re-flash the esp32 

## operating

### WF-005 — Independent focus speed

Implemented: separate saved XY and Z focus speeds are available in the toolbar, Setup and Gamepad. Z defaults to 0.5 RPM. Hardware acceptance remains pending.

problems: 
- the movement motors are very fast but the focus is to fast:
possible solutions: 
- the z focus motor speed has to be settable independently from the x y motor speed


### WF-006 — Post-stop image drift

problem: 
- while moving on x and y after stopping movement the image still drifts away a bit.
possible solutions: 
- this is most likely a hardware problem . the xy sliding parts are connected via direct friction drive (motor shaft has o-rings that touch a silicone strip ) if the motors shafts are push to hard into the silicone this drift is occuring 

possible solution:
- drift could be detected via software (after motor stops quickly check if the image still moves by capturing images and compare translation )
- operator could be informed via pop up text that they have to adjust the hardware


### WF-007 — Forward/backward direction reversal

problem:
the axis assignment is correct, but the operator cannot reverse forward/backward
movement. This is separate from choosing which motor controls X, Y, or Z.

possible solution:
provide a persistent reverse-direction control for each assigned axis, keeping
paired manual inputs opposite and the motor assignment unchanged.

Hotfix status: Setup now has a **Reverse X/Y/Z manual direction** checkbox for
keyboard, mouse and gamepad. Hardware acceptance remains pending; physical
CW/CCW test buttons and automated coordinates retain their existing meaning.
See WF-007 in [workflow_summary.md](workflow_summary.md) for scope and priority.

### WF-008 — Incorrect axis assignment

problem: 
the operator test the motors via 'wasd' but the motor axis are connected wrongly ('a' and 'd' control y axis for example)
possible solution: 
the operator has to reassign / swap motor assignment


### WF-009 — Crowded small-screen UI

problem:  
the operator has a small screen and the UI is to crowded
possible solution: 
the screen size could be detected and the UI should only show one thing at a time and should show the neccessary information more compact


### WF-010 — Widescreen space usage

problem: 
the operator has a very big wide screen and the UI does not make use of the available space
possible solution: 
the screensize could be detected and the UI should show more information. all overlay windows have to be resizeable or at least movable so that the user can orient them in a way that is preferred


### WF-004 — Accessible motor speed

Implemented: always-visible XY/Z sliders and numeric RPM controls, with Slow/Normal/Fast presets. See [workflow_summary.md](workflow_summary.md) for details.

problem: 
crucial things like motor speed are not easily acessible
possible solution: 
the motor speeds should be easily and quickly settable , maybe even 3 presets can be created so that the user can switch with one click
but also a precise slider for the speeds can be implemented on the first layer of UI. 


### WF-011 — Backlash

problem: 
the motors have backlash meaning, when the direction is changed , the change in move is not instantly transmitted to the moving hardware parts
possible solution: 
- the backlash can be minimized in hardware
- the software can compensate for backlash by calibrating the motors (finding out the amount of backlash and then adding extra steps when direction is changed)


### WF-012 — Workflow customization

problem: 
the UI is not adapted to a specific workflow. 
possible solution: 
the overlay windows can be customized. shortcuts can be added to the top bar



### WF-013 — Slide position and mapping

problem: 
the user does not now where they are on the slide
possible solution: 
- build a 'map' (a large stitched /mosaiced image of the full slide by scanning the slide) after this show the user location in a 'minimap'. requires a very very good image stitching tool that is aware of context and can stitch the images together reliably. the classical aproaches are not good enought, a machine learning / trained AI model is required to help with finding how the images overlap correctly and how they can be stitched together. 




problem: 
some microorganisms like '
possible solutions: 


