import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from h import *
name, vault, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
scale = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] != '-' else None
fresh = not (len(sys.argv) > 5 and sys.argv[5] == 'keep')
a = App(name, vault, port, scale=scale).start(fresh=fresh)
print("started", a.proc.pid)
