# computer vision models
trained computer vision models can help out dramastically in automatizing counting of microorganisms. 

unfortunately at the point of time there is no trained model therefore we need to implement a way to train a model 


there may be other ways and approaches but this will describe the implementation of fine tuning the yolo model 



# workflow
- select or create dataset
- go to interesting region 
- add or remove labels 
- set number of regions x and y 
- set steps distance to travel x and y 
- set number of focus planes
- set start focus
- set end focus
- press down 'ctrl' to enter bounding box drawing mode: draw bounding boxes on the live image (can use 1,2,3,4,5... the numbers on the keyboard to quickly switch label)
    - label bounding boxes will have colors
    - bounding boxes can be resized (bottom left corner has a 10x10px box hovering over this box makes a arrows resize icon as the curser, then drag and drop can be used to resize) and repositioned (holding down shift makes a hand symbol as the cursor , then drag n drop can be used to reposition)
    - while moving the mouse over the live image there will be overlayed dashed helper guides at the x and y axis position of the mouse 
- click capture button
    - the focus will be set to position 1 and capture images on all focus planes between focus pos 1 and focus pos 2
- training data apprears in list
    - potentially set a quality foreach image
- click 'next' to go top the next grid position


- finally the dataset can be used to fine tune the yolo model with a button 'fine tune YOLO' 
- if there is an existing fine tuned model it can also be infered with a button 'infere YOLO' 


# problems and solutions
problem: 
an image of bloodcells can contain thousands of bloodcells. the operator does not have time to annote every single blood cell on a single image 
if the operator only annotes half of the blood cells out of lazyness or not having time, the other not annoted bloodcells are counted as background and the yolo fine tuning fails

possible solution:
- artificially downscale the usb camera image: define a selected cropped area as the 'image' so that annotation becomes easier  
    - workflow: 
        - click a 'crop' button, the cursor changes to a crop icon. 
        - click point a of the crop bounding box
        - click point b of the crop bounding box
        - the area outside the crop bounding box is heavily darkened (alpha 0.8)
        - annotation outside of the crop bounding box is not possible 





problem: 
the computer freezes or crashes during fine tuning of the model 
solution: 
create and store logs during model fine tuning so that after a reboot the problem can be analized 


