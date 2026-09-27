this is a mode the operator can enter to be able to create image training data from a microscope slide

problem: 
the operator gets lost on the slide and does not know what region already is covered with training data
possible solutions: 
- having a big map/ virtual slide  of the microscope slide , then the software can always show the location of the current region
and can also reconstruct already annoted regions
- the operator can only move with a 'next' button this will travel the region along a snake like pattern over a fixed set grid. 


---
problem: 
there is not enough training data and annotation takes a long time
solution: 
the fact that the z axis is motorized can be helpful. the operator draws only one bounding box on a target . with a click of a button the z axis will automatically go through multiple z axis planes and create multiple images with the same annotation xy location . since the focus is different on each image , the training data will increase.
other phyiscal properties may also be automatically changed before taking each image, such as camera ISO and exposure time. or if motorized filters and light source of the micorscope. digital data augmentation can always be done later, so we do not need to do it here


---
problem:
operator missclicked and draw a wrong box
possible solution:
annotation bounding boxes have to be deletable


---
problem:
operator needs to check the resulting gathered information 
possible solution: 
the stored data ,annoted image  and also cropped annoted images are shown to the operator and still can be deleted or marked with tags.  for example 'bad', 'medium', or 'good quality'

---
problem:
a lot of annotation has been done but some information has not been stored. 
solution: 
store as much helpful annotation meta data as possible. things like relative x y z position. camera settings. date. and whatever could be helpful
