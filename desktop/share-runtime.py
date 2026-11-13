"""Stage the redistributable Python runtime and document readers."""
import importlib.metadata as metadata
from pathlib import Path
import shutil
import sys
import sysconfig

source = Path(sys.base_prefix)
stdlib = Path(sysconfig.get_path("stdlib"))
target = Path(sys.argv[1])
python_lib = target / "lib" / stdlib.name
target.joinpath("bin").mkdir(parents=True)
shutil.copy2(source / "bin" / "python3.12", target / "bin")
shutil.copytree(stdlib, python_lib, ignore=shutil.ignore_patterns(
    "site-packages", "__pycache__", "test", "tests", "_tkinter*.so", "tkinter",
))
# Include only the distributions used by the existing file readers and previews.
packages = [
    "pypdf", "pypdfium2", "Pillow", "openpyxl", "et-xmlfile",
    "python-pptx", "lxml", "XlsxWriter", "typing-extensions",
]
site = python_lib / "site-packages"
for name in packages:
    distribution = metadata.distribution(name)
    for entry in distribution.files or ():
        if ".." in entry.parts or "__pycache__" in entry.parts or entry.suffix == ".pyc":
            continue
        path = Path(distribution.locate_file(entry))
        if path.is_file():
            destination = site / entry
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
