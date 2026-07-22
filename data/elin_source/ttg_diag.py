import os, collections, traceback
from UnityPy import Environment
from UnityPy.enums import ClassIDType

GAME_DATA = r"D:/MySpace/Elin.Build.20891127/Elin_Data"
env = Environment(GAME_DATA)

mb = 0
script_ok = 0
script_err = 0
cls_count = collections.Counter()
render_names = []
err_samples = []
for obj in env.objects:
    if obj.type != ClassIDType.MonoBehaviour:
        continue
    mb += 1
    try:
        data = obj.read(check_read=False)
    except Exception as e:
        script_err += 1
        if len(err_samples) < 3:
            err_samples.append("read: " + repr(e))
        continue
    ms = getattr(data, "m_Script", None)
    if ms is None:
        continue
    try:
        script = ms.read()
    except Exception as e:
        script_err += 1
        if len(err_samples) < 3:
            err_samples.append("m_Script.read: " + repr(e))
        continue
    script_ok += 1
    cls = getattr(script, "m_ClassName", "") or "?"
    cls_count[cls] += 1
    if "Render" in cls:
        render_names.append(cls)

print("MonoBehaviour total:", mb)
print("script_ok:", script_ok, "script_err:", script_err)
print("distinct classes:", len(cls_count))
print("err samples:", err_samples)
print("\nRender* classes seen:", collections.Counter(render_names))
print("\nTop 40 classes:")
for c, n in cls_count.most_common(40):
    print(f"  {n:5d}  {c}")
