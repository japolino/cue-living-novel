r"""Fold the ImageNet normalisation into a BiRefNet checkpoint for ComfyUI's RemoveBackground.

ComfyUI's native background removal (comfy/background_removal/birefnet.json) feeds BiRefNet
pixels in 0..1 with mean 0 / std 1, i.e. WITHOUT the ImageNet normalisation BiRefNet was
trained with (mean 0.485/0.456/0.406, std 0.229/0.224/0.225). The stock checkpoints
(Comfy-Org birefnet.safetensors, lucida.safetensors; ToonOut .pth) are the original weights,
so their masks come out worse than the model can do: on white-themed sprites on white,
BiRefNet IoU 0.949 unfolded vs 0.976 folded, ToonOut 0.949 vs 0.962 (docs/SPRITE_MODE.md).

This writes an fp16 safetensors with the normalisation folded into every convolution that reads
the input image: bb.patch_embed.proj (4x4 stride 4, no padding: exact) and
decoder.ipt_blk{1..5}.conv1 (3x3 pad 1 on stacked image patches: exact except the outermost
feature-map ring). It also sanitises BatchNorm channels with a non-finite running_var (one in
Lucida) so fp16 compute cannot turn them into NaN. Put the output in
ComfyUI/models/background_removal/ and pick it in LoadBackgroundRemovalModel.

Needs torch and safetensors (ComfyUI's own Python has both). Run it with ComfyUI's Python:
  python_embeded\python.exe fold_birefnet.py ComfyUI\models\background_removal\birefnet.safetensors ComfyUI\models\background_removal\birefnet_cue_folded.safetensors
Usage: fold_birefnet.py <in.(pth|safetensors)> <out.safetensors> [--no-fold]
"""
import sys
import torch
from safetensors.torch import load_file, save_file

src, dst = sys.argv[1], sys.argv[2]
fold = "--no-fold" not in sys.argv
if src.endswith(".pth"):
    sd = torch.load(src, map_location="cpu", weights_only=True)
else:
    sd = load_file(src)
def strip(k):
    # only leading wrapper prefixes (DataParallel "module.", torch.compile "_orig_mod."); keys such as
    # "squeeze_module.0..." contain "module." too and must stay as they are
    for pre in ("module.", "_orig_mod."):
        if k.startswith(pre):
            k = k[len(pre):]
    return k
sd = {strip(k): v for k, v in sd.items()}
mean = torch.tensor([0.485, 0.456, 0.406], dtype=torch.float64)
std = torch.tensor([0.229, 0.224, 0.225], dtype=torch.float64)
if fold:
    names = ["bb.patch_embed.proj"] + [f"decoder.ipt_blk{i}.conv1" for i in range(1, 6)]
    for name in names:
        w = sd[name + ".weight"].double()
        b = sd[name + ".bias"].double()
        c = w.shape[1]
        assert c % 3 == 0, (name, w.shape)
        s = std.repeat(c // 3).view(1, c, 1, 1)
        m = mean.repeat(c // 3).view(1, c, 1, 1)
        sd[name + ".weight"] = (w / s).float()
        sd[name + ".bias"] = (b - (w * (m / s)).sum(dim=(1, 2, 3))).float()
# BatchNorm channels with a non-finite running_var (lucida v7 ships one: decoder.gdt_convs_2.1)
# output their bias in fp32 (x / sqrt(inf) = 0); make that explicit so fp16 compute cannot turn it into NaN.
for k in [k for k in sd if k.endswith("running_var")]:
    var = sd[k].float()
    bad = ~torch.isfinite(var)
    if bad.any():
        pre = k[: -len("running_var")]
        sd[pre + "weight"] = sd[pre + "weight"].float().masked_fill(bad, 0.0)
        sd[pre + "running_mean"] = sd[pre + "running_mean"].float().masked_fill(bad, 0.0)
        sd[k] = var.masked_fill(bad, 1.0)
        print("sanitized", k, int(bad.sum()), "channel(s)")
out = {k: (v.half() if v.is_floating_point() else v).contiguous() for k, v in sd.items()}
save_file(out, dst)
print("wrote", dst, len(out), "tensors, folded" if fold else "tensors, unfolded")
