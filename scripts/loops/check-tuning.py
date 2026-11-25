"""Measures each sampled instrument's sounding pitch against its file names (the semitone shifts in
instruments.SAMPLED come from this). Usage: python3 scripts/loops/check-tuning.py grand flute ..."""
import sys; sys.path.insert(0, __import__('os').path.dirname(__file__))
import numpy as np, math, instruments as I
from dsp import SR
def hps(x):
    m=x.mean(axis=1); seg=m[int(0.05*SR):int(0.05*SR)+16384]
    if len(seg)<16384: seg=np.pad(seg,(0,16384-len(seg)))
    S=np.abs(np.fft.rfft(seg*np.hanning(len(seg)),65536))
    f=np.fft.rfftfreq(65536,1/SR)
    # strongest peak between 25 and 5000 Hz
    band=(f>25)&(f<5000)
    pk=f[band][np.argmax(S[band])]
    return pk
for n in sys.argv[1:]:
    s=I.Sampler(n); out=[]
    for z in s.notes[::max(1,len(s.notes)//6)]:
        x=s._sample(z,4,1); pk=hps(x); m=69+12*math.log2(pk/440)
        out.append(f'{z}:{m-z:+.1f}')
    print(n,' '.join(out))
