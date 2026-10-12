the SAM here in this demo , the inference is ultra fast, like milliseconds fast. i installed sam locally and inference takes long. the demo says the SAM model runs in the browser. what i am doing wrong. am i using the wrong model in my application?
https://segment-anything.metademolab.com/demo#















You are probably not using the wrong SAM model. You are likely running the full segmentation pipeline for every interaction, while Meta's demo separates the expensive computation from the fast part.
This is a major architectural difference.
1. Why Meta's SAM demo is so fast
The original Segment Anything Model (SAM) has two main components:
Image Encoder (expensive)
Processes the image and generates image embeddings.
Run once per image


Mask Decoder (lightweight)
Takes cached embeddings plus mouse clicks or bounding boxes and produces masks.
Run on every interaction — potentially milliseconds


The key idea is that the image encoder does not need to run every time you click on the image.
Meta's browser demo uses this separation to make interactive segmentation extremely responsive.
If your application calls the full SAM model every time a user clicks, you are repeatedly doing the most expensive part of the computation.
2. The actual performance numbers from Meta
Meta documents the following performance for the original SAM:
Operation	Reported latency	Hardware
Image encoding	~150 ms	NVIDIA A100 GPU
Prompt + mask decoding	~50 ms	Browser CPU, multithreaded SIMD
These are reference measurements, not guaranteed timings on your hardware. 

Meta AI
+1



Importantly, Meta's reference browser implementation loads precomputed image embeddings and runs only the ONNX mask decoder in the browser. It does not calculate the large image encoder on every mouse movement. 

GitHub



3. How to reproduce this locally
If you use the original Python SAM package, your application should follow this pattern:
import torchimport numpy as npfrom segment_anything import sam_model_registry, SamPredictordevice = "cuda" if torch.cuda.is_available() else "cpu"sam = sam_model_registry["vit_b"](    checkpoint="sam_vit_b_01ec64.pth")sam.to(device=device)sam.eval()predictor = SamPredictor(sam)# EXPENSIVE: run once when the image changespredictor.set_image(image_rgb)# FAST: repeat for each click on the same imagewith torch.inference_mode():    masks, scores, logits = predictor.predict(        point_coords=np.array([[250, 180]]),        point_labels=np.array([1]),        multimask_output=True    )



The important part is keeping predictor alive and calling set_image() only when the image changes.
For browser-based inference, Meta also provides its original implementation:
Meta's official SAM browser demo source code.
It uses ONNX Runtime Web, WebAssembly, SIMD and multithreading.
4. Which model should you use?
Model	Best use
SAM ViT-H	Original high-capacity model; expensive encoder
SAM ViT-B	Smaller original SAM; easier to run locally
MobileSAM	Lightweight alternative for constrained hardware
SAM 2	Newer image/video segmentation workflows
For an application where the user clicks objects and expects immediate segmentation, I would start with cached image embeddings and an ONNX mask decoder before changing the model.
If you're currently using SamAutomaticMaskGenerator, that is another possible explanation: it performs automatic segmentation across many prompts, which is a much heavier operation than predicting a mask from one click.
5. Three questions about your application
1. Which SAM are you using? SAM ViT-H, ViT-L, ViT-B, SAM 2, MobileSAM, or something else?
2. What hardware are you running on? NVIDIA GPU, Apple Silicon, or CPU?
3. How are you invoking SAM? Python/PyTorch, ONNX Runtime, or JavaScript in the browser?
With these details, I can tell you whether you need a different model or simply need to change your inference architecture to achieve Meta-demo-like latency.