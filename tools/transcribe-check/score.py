import sys, re, difflib, collections
ref=open(sys.argv[1]).read(); hyp=open(sys.argv[2]).read()
norm=lambda s: re.findall(r"[a-z0-9']+", s.lower())
r,h=norm(ref),norm(hyp)
sm=difflib.SequenceMatcher(None,r,h,autojunk=False)
match=sum(b.size for b in sm.get_matching_blocks())
sents=[x.strip().lower() for x in re.split(r'[.!?]', hyp) if len(x.strip())>20]
top=collections.Counter(sents).most_common(1)
print(f"words ref {len(r)} out {len(h)} | ref words found {100*match/len(r):.0f}% | most-repeated sentence x{top[0][1] if top else 0}")
