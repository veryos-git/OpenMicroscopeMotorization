the motors shafts have o rings on them. they are directly connected via friction to a silicon rubber that moves the stage which is on a guiding rail . 

the 28 byj 48 steppers can have quite some backlash out of factory. 
therefore we need calibration. 

# calibration principle
basic principle of calibration could work like this: 
the stage is moved into one direction for so many steps to be shure that the gears engaged. after this it probes steps to the other direction . after each probe it is measured if the image moved / translated. if it is the case the gears must have engaged. this then could be repeated to get a confirming calibration value




# workflow
- operator opens 'setup' or 'hardware' and clicks calibrate next to a single specific motor
- or operator clicks 'quickly calibrate all'


# problems and possible solutions
problem: 
when changing x direction the focus is also changed
this could be because the motor is pressing down to much onto the x stage and therefore lifting the stage slightly so that a direction change also changes the focus
possible solution: 
- compensate in software (really hard to compensate)
- check and improve hardware installation


problem: 
z focus is not the same over the whole slide, in one left  upper corner focus is there but it is not the same in lower right corner. this might be because the full stage assembly is not level. 
possible solution: 
the full slide could be probed for leveling by measuring focus at points of a virtual grid. 
then the focus could be compensated in software. however this is difficult if the hardware is anyways not precise and steps get often lost . we only have relative steps  and no closed-loop stepper motors so far. 

problem: 
the assembly is also possible to use without adding a motor to the focus. in this case however the software has to adapt and has to know if there is a focus or not. 
- sub problem:
    - the calibration of the focus never will find a backlash because there is no focus motor and there is no way to control the focus via software
- possible solution
    - while calibrating the focus motor. first check very coarse by moving a lot of steps like 100 steps, check if the focus even move a bit. if not the focus motor might not be connected or not installed at all. if this is the case 
    the user should get a warning and the software should be aware at anytime that the focus motor is not connected. this might be also visualized in a short hardware overview where the user sees what all is connected and what not. 