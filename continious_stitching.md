i want to implement a 'realtime' continious stitching. 
the basic process goes like this. 
there is a identification string for the current image {name}_mm_hh_DD_MM_YYYY , the name can be set with an input. there is also a button to create a new automatic stitch. if a new name is entered a new stitch image base will be crated


the basic though behind the autostitching is this. the user will look at a slide. in an interval the client will send the current image to the server. the server tries to add this image to the already existing image so it extends the already existing image 
if the users explores the whole slide the final image will be a image that is the whole slide. it's a bit like fog of war in age of empires. only that all the images have to be overlapping. 

if for example there is a base image and the images cannot be stitched to the base image this implies that the user currently looks at a very different region of the slide. this would mean the base image has to be renewed to an image of the current location. 

if the slide stays at the same postion for a long time the image would always replace the current image since it would overlap almost 100% , to prevent this, the process should only extend the image if it extend it by some amount of pixels in percentage. 


if this hole process works , a automatic stitched image is created slowly. this image should be shown like a minimap. and the position of the current image in this auto stitched image result (if found) should be displayed with a rectangular red border.

the interval (in seconds) for automatically sending current image should be settable default is 5 seconds

summarize the task (how you understood it) in autostitch_ai_summary.md and implement this into the application