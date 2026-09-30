the ui of the application should be generally expressed with more icons than text. if text is used it should only be used precicely. 

the application is intented to work in combination with a microscope and hardware, all together is called the assembly. 
the application is intented to run as a fullscreen window. all the functionalities can be accessed by toggling overlay windows. 
each overlay window can be resized and moved. 


Implemented: overlay windows can be moved by dragging their header with a mouse,
pen, or touch. Selecting a window brings it forward; header buttons and fields
remain interactive. Positions are kept while panels are hidden/reopened, and moved
windows are kept within the viewport when it changes size. Digital zoom keeps its
existing position handling. General window resizing remains a separate task.



problem: 
- the UI is simply to crowded. for advanced users it makes sense to see all details but for a quick look it is overwhelming. 
possible solution: 
- provide the most accessed functions on the first layer of the GUI, so that no overlay has to be opened. 
- use icons/pictograms. they often tell a lot more than having to read complex long text 
- use tool tip text when hovering over an item with complex functionality (buttons with icons , and others)

