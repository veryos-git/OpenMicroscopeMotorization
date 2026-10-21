this feature allows the operator to select a target and let the stage automatically follow it. 

this is a very complex feature and has many possible problems



problem:
the target identification does not work
possible solution: 
- use a better motion detection algo or better settings or 
    - prblm: the algo cannot work because the organism stops and moves again later
    - posssol: simply use machine learning 

- use machine learning approaches such as fine tuning yolo models: 
    - prblm: the target is not accurately detected 
    - posssol: the training data is not good enough, aquire more , more diverse and better anoted training data


problem:
the target is to fast , the hardware is to slow and inprecise to follow 
possible solution:
find a solution to create better more reliable hardware

problem: 
the target quickly changes position: 
possible solution: 
try to calculate some kind of average direction (if even possible), and try to analize the movement before simply trying to blindly follow




