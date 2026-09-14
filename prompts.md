i want to be able to make the installation of this software as easy as possible so i want to have all in one startup / installation script. so the end user only needs to run one command
the user only needs to install deno js , the installation script then checks with (Deno.command?) if any other binary like esptool has to be installed
---
next step is to improve the software. there should be a feature that visualizes the movement on a canvas. it shows the trace of where the center 'passed'. and it somehow is like a minimap in a computer game, it provides an overview of the xy cartesian system. later if a webcam is implemented , the images could also be stitched and used as a background on this 'minimap'. 

---
the flow of the application is the following 
 user should start web application 
 user should land on the start page where user can set the pins for motor 'x' and motor 'y'
 user should be able to generate a code 
 user should be able to see if a esp32 is connected or not
 user should be able to flash the esp32 
 the flashing process should be mointored
 after the esp32 is flashed user should be taken to the microscope controll gui webpage

 if the user starts the webapp and a esp32 is already connected the user should be taken to the microscope controll page 
 
---
the webcam video should not be a <video> html element but a canvas element

---
create another overlay window 'scan' that is there for the functionality of scanning a region of the current slide. 
it fundamentally works like this: 
    when started a new folder for this particular scan is created on the server. after this the user control of the motors is disabled.  the script automatically controlls the xy motors so that the microscope slide
    moves in a snake like path. then after each movement (x or y) a picture is taken and stored in a new folder on the server. a started scan, can be stopped at any time. each picture should have a certain overlap . finally all taken pictures can be stitched by another process. the final result will be a big stitched image. 
    before starting a scan , the programm needs to know some information from the user 
    the user can enter:
        distance of movements.
            depending on the current zoom factor / depending on what lens the microscope has on , the movement distance should be bigger or smaller. also depending on the aspect ratio of the microscope webcam image the movement on the axis x and y are most likely not the same. for example if the aspec ratio is 2:1, the movement on the x axis would be twice as much as the movement on the y axis. 
            the movement distance can be entered in steps. next to the input there should also be a button 'test distance' if this is pressed , the currently set distance will be executed by the motor , this way a user can set and fine tune a correct  movement distance. 
        tiles 
            how many movements should be done on each axis the multiplied result of those two numbers will be the amount of images taken, for example 3x3 => 9 images, 
        x tiles (default 3)
        y tiles (default 3)

---
there is a fundamental problem when moving the xy table. 
unfortunately the stepper motors have some backlash. this means that if the motor direction is changed , the motor shaft will not imediately turn to the other direction. we have to compensate for this. so when changing direction there should be a movement of n additional steps that are done. those compensation steps should be done in the fastest speed possible. the steps that follow after the direction change are 'normal' again (depening on the current motor speed)  
in the motors panel there should be a config value where a user can enter the number of compensation steps