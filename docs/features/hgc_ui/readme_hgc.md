fullscreen: 
    - generally this app is a full screen app, that is like a cockpit of a pilot. The UI and possitions of input elements have to be carefully designed and everything in the UI has a special well thought-out place.
        - the hand drawn sketch is the source of truth of its UI.
        - a readme_hgc.md next to a sketch only corrects or extends it, and wins on conflict. when the sketch is redrawn, the corrections go into the drawing and the readme is archived.
        
workflow for new UI content
- an LLM may build a coarse functional draft: a draft UI will be clearly marked as a draft.
- the programmer has to draw the final layout by hand with pen and paper; the window is refined from that drawing
- no drawing yet: ask for one before refining the layout
- sketches: docs/features/hgc_ui/overlay_windows/[name] and docs/features/hgc_ui/input_elements/[name]

one master layer (permanently shown):   
    - top bar: 
        - see  docs/features/hgc_ui/overlay_windows/general/general_top_bar.jpeg for more detailed guides
    - live usb image
        - is permanently shown, positioned bottom left, takes as much space as possible 

second layer: 
    - overlay windows (only shown when opened)

- no collapsible sections: 
    - there should not be hidden information or hidden ui in collapsible sections

No text in UI:
    - allowed text: 
        - window title
        - button lables: 1-3 words
        - values with units (example: 50% '1920x1080')
        - status and counters ( example: 3/15)
    - everything else goes into a tooltip (only if really required): sentences, explanations, why a button is disabled


pictograms: 
    - clean simple useful pictograms
        - an image says more than thousand words
        - a pictogram does not have a language, is universal
    
tooltip: 
    - appears instantly next to the cursor when hovering an item
    - gives more context: may contain a longer explanation where needed
    - while a tool is active , the tooltip follows the cursor and says what to do (example: 'click to measure distance')




overlay windows: 
    - should be optimized so that the content fits to one screen

input elements: 
    - only a few different elements should be used 
    - they should be standardized in the code as re-usable code modules

screensize: 
    - a desktop screensize with at least 1920x1080 is expected
        - this is not a app for any kind of mobile phone





not only UI functionality but also important: 
search: 
    - there is a search functionality that allows to find any function, similar to f3 in blender, / in gimp  or ctrl+shift+p in vscode
    - default shortcut: ctrl+shift+p

