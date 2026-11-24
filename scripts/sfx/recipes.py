"""Recipes for the demo's synthesized sound effects. Each recipe makes an original sound from
oscillators, noise and filters; nothing is sampled from a recording.

A recipe is `fn(rng, **params) -> np.ndarray` (mono or stereo, any level; build-demo-sfx.py
normalizes it). SOUNDS lists every sound the library ships with its place in the browse tree.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

from dsp import (
    SR, at, bitcrush, blockfilter, bp, brown, curve, doppler_pass, drive, env_adsr, env_perc, hp, lp, mix, n_of,
    noise, pan, peak, pink, reverb, saw, sine, square, svf, t_axis, to_stereo, tri,
)


# =============================================================================================
# Sirens and alarms


def siren_wail(rng, sec=6.0, lo=650, hi=1450, period=3.0, distance=0.0, doppler=False, tone="square"):
    t = t_axis(sec)
    ph = (t / period) % 1.0
    shape = np.where(ph < 0.55, np.sin(ph / 0.55 * np.pi / 2), np.cos((ph - 0.55) / 0.45 * np.pi / 2))
    f = lo + (hi - lo) * shape
    osc = square(f, harmonics=12, duty_soft=1.25) if tone == "square" else saw(f, harmonics=16)
    x = bp(osc, 1600, 0.6) * 0.8 + lp(osc, 3500) * 0.4
    x = drive(x, 1.6)
    if doppler:
        x = doppler_pass(x, sec, speed=22, closest=5)
        x = reverb(x, rng, 1.2, 0.25)
    else:
        if distance:
            x = lp(x, 4000 - 2800 * distance) * (1 - 0.4 * distance)
        x = reverb(x, rng, 0.8 + 1.8 * distance, 0.15 + 0.5 * distance)
    return x


def siren_yelp(rng, sec=4.0, lo=700, hi=1500, rate=4.2, distance=0.0):
    t = t_axis(sec)
    ph = (t * rate) % 1.0
    f = lo + (hi - lo) * np.where(ph < 0.5, ph * 2, (1 - ph) * 2) ** 0.8
    x = drive(bp(square(f, harmonics=12), 1500, 0.7) + 0.3 * lp(saw(f), 3000), 1.8)
    if distance:
        x = lp(x, 3500 - 2000 * distance)
    return reverb(x, rng, 0.9 + distance * 1.5, 0.2 + distance * 0.4)


def siren_hilo(rng, sec=6.0, a=435.0, b=580.0, step=0.55, distance=0.0, doppler=False):
    n = n_of(sec)
    t = np.arange(n) / SR
    which = (np.floor(t / step) % 2).astype(bool)
    f = np.where(which, b, a)
    f = lp(f, 40)
    x = drive(bp(saw(f, harmonics=24), 1100, 0.5) + 0.25 * square(f, harmonics=10), 1.5)
    if doppler:
        x = reverb(doppler_pass(x, sec, 20, 5), rng, 1.0, 0.25)
    else:
        if distance:
            x = lp(x, 3000 - 1500 * distance)
        x = reverb(x, rng, 0.8 + distance * 2, 0.2 + distance * 0.45)
    return x


def air_raid(rng, sec=14.0, top=470.0, rotor=9.0, distance=0.6):
    # A motor siren: a slow rise to pitch, a hold, a long fall, chopped by the rotor ports.
    f = curve([(0, 60), (3.5, top * 0.92), (5.5, top), (8.5, top * 0.98), (sec, 70)], sec)
    fund = saw(f, harmonics=10)
    third = sine(f * 1.5) * 0.25  # two-tone chord on a dual-rotor siren
    chop = 0.6 + 0.4 * np.sin(2 * np.pi * np.cumsum(f / top * rotor) / SR)
    x = (fund + third) * chop
    x = lp(x, 2200) + 0.15 * bp(noise(len(x), rng), 800, 1.2) * chop
    x = drive(x, 1.3)
    return reverb(x * (1 - 0.3 * distance), rng, 2.5 + 2 * distance, 0.35 + 0.4 * distance, damp=3000)


def tornado_siren(rng, sec=16.0):
    # A rotating horn: the level swells as it points at you and away again.
    f = curve([(0, 80), (4, 540), (sec - 3, 545), (sec, 200)], sec)
    t = t_axis(sec)
    x = lp(saw(f, harmonics=12) + 0.4 * saw(f * 1.19, harmonics=8), 2400)
    sweep = 0.35 + 0.65 * (0.5 + 0.5 * np.cos(2 * np.pi * t / 5.5)) ** 1.6
    x = x * sweep
    x = x * (1 - 0.6 * (1 - sweep)) + lp(x, 700) * 0.6 * (1 - sweep)
    return reverb(x, rng, 4.0, 0.6, damp=2500)


def klaxon(rng, sec=4.0, f0=310.0, beats=3, gap=0.3):
    out = np.zeros(n_of(sec))
    for i in range(beats):
        d = 0.55
        tt = t_axis(d)
        f = f0 * (1 + 0.25 * np.clip(tt / 0.12, 0, 1))  # "a-OO-ga" pitch rise
        f = f * (1 - 0.18 * np.clip((tt - 0.35) / 0.2, 0, 1))
        s = drive(bp(square(f, harmonics=20), 900, 0.6) + 0.4 * saw(f), 2.5) * env_adsr(len(tt), 0.01, 0.05, 0.9, 0.08)
        at(out, s, i * (d + gap))
    return reverb(out, rng, 1.6, 0.3)


def submarine_dive(rng, sec=5.0, pulses=2):
    out = np.zeros(n_of(sec))
    for i in range(pulses):
        d = 1.1
        f = curve([(0, 340), (0.08, 420), (d, 410)], d)
        s = drive(square(f, harmonics=16) * 0.7 + saw(f * 2) * 0.2, 2.2)
        s = bp(s, 1000, 0.5) * env_adsr(len(s), 0.02, 0.1, 0.9, 0.15)
        at(out, s, i * 1.6)
    return reverb(out, rng, 2.2, 0.45, damp=3500)


def fire_alarm_horn(rng, sec=5.0, f0=3100.0, temporal=True):
    # NFPA temporal-3 pattern: three 0.5 s pulses, then a 1.5 s pause.
    out = np.zeros(n_of(sec))
    starts = [0, 1, 2] if temporal else [i * 0.3 for i in range(int(sec / 0.3))]
    on = 0.5 if temporal else 0.15
    for s0 in starts:
        tt = t_axis(on)
        buzz = square(f0 + 30 * np.sin(2 * np.pi * 60 * tt), harmonics=4) * 0.6 + square(520, len(tt), harmonics=8) * 0.5
        s = drive(buzz, 2.0) * env_adsr(len(tt), 0.005, 0.02, 0.95, 0.01)
        at(out, s, s0)
    return reverb(out, rng, 1.0, 0.25)


def bell_ringer(rng, sec=4.0, f0=1850.0, hammer=22.0, partials=(1, 2.32, 4.25, 6.63), decay=0.6):
    """An electric bell: a hammer striking a gong many times a second."""
    n = n_of(sec)
    t = np.arange(n) / SR
    strikes = np.zeros(n)
    for k in np.arange(0, sec - 0.2, 1 / hammer):
        i = int((k + rng.uniform(0, 0.002)) * SR)
        if i < n:
            strikes[i] = rng.uniform(0.7, 1)
    body = np.zeros(n)
    for j, p in enumerate(partials):
        ir_n = n_of(decay)
        ir = np.sin(2 * np.pi * f0 * p * np.arange(ir_n) / SR) * np.exp(-np.arange(ir_n) / SR / (decay / (1 + j)))
        body += signal.fftconvolve(strikes, ir)[:n] / (1 + j * 0.7)
    body *= env_adsr(n, 0.001, 0.01, 1, 0.05, hold=sec - 0.3)
    tail = np.exp(-np.maximum(0, t - (sec - 0.3)) / 0.5)
    return reverb(body * tail, rng, 1.2, 0.2)


def digital_alarm(rng, sec=4.0, f0=4000.0, pattern="quad"):
    out = np.zeros(n_of(sec))
    beep = 0.07
    if pattern == "quad":
        groups, per, step = [0.0], 4, 0.12
        groups = list(np.arange(0, sec - 0.6, 1.0))
    elif pattern == "double":
        groups, per, step = list(np.arange(0, sec - 0.4, 0.7)), 2, 0.14
    else:
        groups, per, step = list(np.arange(0, sec - 0.2, 0.5)), 1, 0.0
        beep = 0.25
    for g in groups:
        for k in range(per):
            s = square(f0, n_of(beep), harmonics=3) * env_adsr(n_of(beep), 0.002, 0.005, 1, 0.004)
            at(out, s, g + k * step)
    return lp(out, 9000) * 0.6


def car_alarm(rng, sec=8.0):
    """A cycling six-tone car alarm: whoop, warble, chirps, two-tone, each a second or so."""
    parts = []
    t1 = t_axis(1.4)
    parts.append(square(600 + 1200 * ((t1 * 2.2) % 1), harmonics=8))  # rising whoops
    t2 = t_axis(1.3)
    parts.append(square(np.where((t2 * 7) % 1 < 0.5, 1200, 1700), harmonics=8))  # warble
    t3 = t_axis(1.3)
    parts.append(square(2600, len(t3), harmonics=4) * ((t3 * 12) % 1 < 0.45))  # chirps
    t4 = t_axis(1.4)
    parts.append(square(1000 + 900 * np.sin(2 * np.pi * 1.3 * t4) ** 2, harmonics=8))  # sweep
    t5 = t_axis(1.3)
    parts.append(square(np.where((t5 * 2.5) % 1 < 0.5, 900, 1350), harmonics=8))  # hi-lo
    x = np.concatenate(parts)[: n_of(sec)]
    x = drive(bp(x, 1800, 0.6), 2.0)
    return reverb(x, rng, 1.8, 0.4, damp=4000)


def backup_beeper(rng, sec=5.0, f0=1100.0):
    out = np.zeros(n_of(sec))
    for k in np.arange(0, sec - 0.5, 1.0):
        s = square(f0, n_of(0.5), harmonics=5) * env_adsr(n_of(0.5), 0.005, 0.01, 1, 0.01)
        at(out, s, k)
    return reverb(bp(out, 1300, 0.8), rng, 1.6, 0.45)


def heart_monitor(rng, sec=6.0, bpm=72, flatline_at=None):
    out = np.zeros(n_of(sec))
    end = flatline_at if flatline_at is not None else sec
    for k in np.arange(0.2, end, 60 / bpm):
        s = sine(1000, n_of(0.12)) * env_adsr(n_of(0.12), 0.003, 0.02, 0.9, 0.02)
        at(out, s, k)
    if flatline_at is not None:
        s = sine(1000, n_of(sec - flatline_at)) * env_adsr(n_of(sec - flatline_at), 0.003, 0.01, 1, 0.2)
        at(out, s, flatline_at + 0.3)
    return reverb(out * 0.5, rng, 0.6, 0.15)


def buzzer(rng, kind="wrong"):
    if kind == "wrong":
        d = 1.0
        x = square(curve([(0, 160), (d, 140)], d), harmonics=30) + square(curve([(0, 166), (d, 145)], d), harmonics=30)
        x = drive(lp(x, 3000), 2) * env_adsr(len(x), 0.005, 0.05, 0.9, 0.1)
    elif kind == "correct":
        x = np.zeros(n_of(0.9))
        for i, f in enumerate([880, 1318.5]):
            s = (sine(f, n_of(0.5)) + 0.3 * sine(f * 2, n_of(0.5))) * env_perc(n_of(0.5), 0.003, 0.18)
            at(x, s, i * 0.12)
    elif kind == "shot-clock":
        x = drive(square(560, n_of(1.6), harmonics=25) + saw(563, n_of(1.6)), 3) * env_adsr(n_of(1.6), 0.005, 0.05, 1, 0.05)
        x = bp(x, 900, 0.5)
    else:  # store door chime
        x = np.zeros(n_of(2.0))
        for i, f in enumerate([659.25, 523.25]):
            s = sum(sine(f * p, n_of(1.6)) / (1 + j) for j, p in enumerate([1, 2.76, 5.4])) * env_perc(n_of(1.6), 0.002, 0.5)
            at(x, s, i * 0.45)
    return reverb(x, rng, 1.0, 0.25)


def school_bell(rng, sec=5.0):
    return bell_ringer(rng, sec, f0=880, hammer=18, partials=(1, 2.0, 3.01, 4.17), decay=0.9)


def alarm_clock_bell(rng, sec=4.0):
    # Twin bells hit alternately by one hammer.
    a = bell_ringer(rng, sec, f0=2400, hammer=16, partials=(1, 2.4, 4.5), decay=0.35)
    b = bell_ringer(rng, sec, f0=2650, hammer=16, partials=(1, 2.35, 4.6), decay=0.35)
    return a + b


# =============================================================================================
# Phones and voicemail


def tones(fs, sec, amp=0.4):
    n = n_of(sec)
    return sum(sine(f, n) for f in fs) * amp


def cadence(fs, on, off, cycles, amp=0.4, lead=0.0):
    out = np.zeros(n_of(lead + cycles * (on + off)))
    for c in range(cycles):
        s = tones(fs, on, amp) * env_adsr(n_of(on), 0.004, 0.0, 1, 0.006)
        at(out, s, lead + c * (on + off))
    return out


def phone_line(x, rng, hiss=0.01):
    """The sound of a telephone line: 300 to 3400 Hz, a little hum and hiss."""
    x = to_mono(x)
    y = bp(x, 1450, 0.47, order=3)
    y = drive(y * 1.4, 1.3)
    y = y + hiss * hp(noise(len(y), rng), 2000) + 0.004 * sine(60, len(y))
    return y


def to_mono(x):
    return x.mean(axis=1) if x.ndim == 2 else x


def ringback_us(rng, cycles=3):
    return phone_line(cadence([440, 480], 2.0, 4.0, cycles), rng)


def ringback_uk(rng, cycles=3):
    out = np.zeros(n_of(cycles * 3.0))
    for c in range(cycles):
        for k in (0, 0.6):
            s = tones([400, 450], 0.4) * env_adsr(n_of(0.4), 0.004, 0, 1, 0.006)
            at(out, s, c * 3.0 + k)
    return phone_line(out, rng)


def dial_tone(rng, sec=4.0, us=True):
    return phone_line(tones([350, 440] if us else [425], sec), rng)


def busy_signal(rng, cycles=6, fast=False):
    on = 0.25 if fast else 0.5
    return phone_line(cadence([480, 620], on, on, cycles), rng)


def off_hook_howler(rng, sec=4.0):
    return phone_line(cadence([1400, 2060, 2450, 2600], 0.1, 0.1, int(sec / 0.2), amp=0.3), rng)


def intercept_tones(rng, then_voice=True):
    # Special information tones: the three rising notes before "the number you have dialed...".
    out = np.zeros(n_of(1.6 if not then_voice else 4.2))
    for i, (f, d) in enumerate([(913.8, 0.274), (1370.6, 0.274), (1776.7, 0.380)]):
        at(out, tones([f], d, 0.6) * env_adsr(n_of(d), 0.003, 0, 1, 0.006), sum([0.274, 0.274][:i]))
    if then_voice:
        at(out, gibberish(rng, sec=2.4, pitch=180, gender="f", rate=5.2, line=False), 1.2, 0.8)
    return phone_line(out, rng)


DTMF = {"1": (697, 1209), "2": (697, 1336), "3": (697, 1477), "4": (770, 1209), "5": (770, 1336), "6": (770, 1477),
        "7": (852, 1209), "8": (852, 1336), "9": (852, 1477), "*": (941, 1209), "0": (941, 1336), "#": (941, 1477)}


def dtmf_dial(rng, digits="5550142", on=0.11, gap=0.09, line=True):
    out = np.zeros(n_of(len(digits) * (on + gap) + 0.3))
    for i, d in enumerate(digits):
        at(out, tones(DTMF[d], on, 0.45) * env_adsr(n_of(on), 0.002, 0, 1, 0.003), 0.05 + i * (on + gap * rng.uniform(0.7, 1.4)))
    return phone_line(out, rng, 0.004) if line else out


def rotary_dial(rng, digits="7314"):
    out = np.zeros(n_of(len(digits) * 1.6 + 0.4))
    t0 = 0.1
    for d in digits:
        k = 10 if d == "0" else int(d)
        # wind up: a ratcheting whir; release: k pulse clicks at 10 per second
        wind = bp(noise(n_of(0.35), rng), 2500, 2) * (0.3 + 0.7 * ((t_axis(0.35) * 40) % 1 < 0.3)) * 0.25
        at(out, wind, t0)
        t0 += 0.4
        for p in range(k):
            click = bp(noise(n_of(0.012), rng), 1800, 1.5) * env_perc(n_of(0.012), 0.0005, 0.003)
            at(out, click, t0 + p * 0.1)
        t0 += k * 0.1 + 0.25
    return reverb(out, rng, 0.3, 0.12)


def old_phone_bell(rng, rings=3):
    out = np.zeros(n_of(rings * 6.0 - 3.6))
    for r in range(rings):
        s = bell_ringer(rng, 2.0, f0=1100, hammer=20, partials=(1, 2.62, 4.9), decay=0.4)
        s2 = bell_ringer(rng, 2.0, f0=1310, hammer=20, partials=(1, 2.6, 4.7), decay=0.4)
        at(out, to_mono(s + s2), r * 6.0)
    return reverb(out, rng, 0.9, 0.2)


def trill_ring(rng, rings=3, f1=1250.0, f2=1580.0, rate=16.0):
    """An office phone's electronic trill ring."""
    out = np.zeros(n_of(rings * 3.0))
    for r in range(rings):
        tt = t_axis(1.0)
        f = np.where((tt * rate) % 1 < 0.5, f1, f2)
        s = square(f, harmonics=6) * env_adsr(len(tt), 0.01, 0, 1, 0.02) * 0.5
        at(out, s, r * 3.0)
    return reverb(bp(out, 1700, 0.6), rng, 0.8, 0.2)


def marimba_ring(rng, bars=2, tempo=150.0, seed_melody=0):
    """An original marimba-style ringtone (not any phone maker's melody)."""
    scales = [[0, 4, 7, 12, 7, 4, 9, 7], [0, 7, 5, 4, 12, 11, 7, 9], [0, 3, 7, 10, 12, 10, 7, 5]]
    mel = scales[seed_melody % len(scales)]
    step = 60 / tempo / 2
    out = np.zeros(n_of(bars * len(mel) * step + 1.0))
    for b in range(bars):
        for i, s in enumerate(mel):
            f = 523.25 * 2 ** (s / 12)
            d = 0.6
            note = (sine(f, n_of(d)) + 0.25 * sine(f * 4, n_of(d)) * env_perc(n_of(d), 0.001, 0.03)) * env_perc(n_of(d), 0.002, 0.18)
            at(out, note, (b * len(mel) + i) * step)
    return reverb(out, rng, 0.8, 0.2)


def voicemail_beep(rng, kind="long"):
    if kind == "long":
        x = tones([1000], 0.9, 0.6) * env_adsr(n_of(0.9), 0.004, 0, 1, 0.01)
    elif kind == "machine":
        x = np.zeros(n_of(1.2))
        for i in range(3):
            at(x, tones([1400], 0.12, 0.5) * env_adsr(n_of(0.12), 0.003, 0, 1, 0.005), i * 0.2)
        at(x, tones([1400], 0.5, 0.5) * env_adsr(n_of(0.5), 0.003, 0, 1, 0.01), 0.6)
    elif kind == "end":
        x = np.zeros(n_of(1.4))
        for i in range(3):
            at(x, tones([480 + 0 * i], 0.18, 0.5), i * 0.35)
    else:  # carrier "you have one new message" chime
        x = np.zeros(n_of(1.3))
        for i, f in enumerate([783.99, 1046.5, 1318.5]):
            at(x, (sine(f, n_of(0.7)) + 0.2 * sine(2 * f, n_of(0.7))) * env_perc(n_of(0.7), 0.003, 0.2), i * 0.15)
    return phone_line(x, rng, 0.003)


def voicemail_message(rng, sec=7.0, gender="m", mood="calm"):
    """A gibberish voicemail on a phone line, with the beep before it. The words are not words."""
    beep = tones([1000], 0.7, 0.6) * env_adsr(n_of(0.7), 0.004, 0, 1, 0.01)
    rate = 4.0 if mood == "calm" else 5.8
    pitch = (120 if gender == "m" else 210) * (1.0 if mood == "calm" else 1.25)
    voice = to_mono(gibberish(rng, sec=sec - 1.3, pitch=pitch, gender=gender, rate=rate, excited=mood != "calm", line=False))
    out = np.zeros(n_of(sec))
    at(out, beep, 0)
    at(out, voice, 1.1, 0.9)
    room = to_mono(reverb(out[n_of(1.0):], rng, 0.35, 0.25))
    out[n_of(1.0):] = room[: len(out) - n_of(1.0)]
    return phone_line(out, rng, 0.012)


def hang_up(rng, then_tone=True):
    out = np.zeros(n_of(3.0 if then_tone else 0.6))
    clunk = lp(noise(n_of(0.08), rng), 1500) * env_perc(n_of(0.08), 0.001, 0.015) + 0.6 * sine(180, n_of(0.08)) * env_perc(n_of(0.08), 0.001, 0.02)
    at(out, clunk, 0.05)
    if then_tone:
        at(out, cadence([480, 620], 0.25, 0.25, 4, 0.35), 0.6)
    return phone_line(out, rng, 0.006)


def vibrate(rng, table=True, pulses=3):
    out = np.zeros(n_of(pulses * 1.2))
    for p in range(pulses):
        d = 0.45
        tt = t_axis(d)
        motor = saw(165 + 10 * np.sin(2 * np.pi * 7 * tt), harmonics=30)
        if table:
            motor = drive(motor * 1.5, 3) * 0.6 + bp(noise(len(tt), rng), 900, 1.2) * 0.4 * (np.sin(2 * np.pi * 165 * tt) > 0.6)
        s = lp(motor, 2500) * env_adsr(len(tt), 0.01, 0, 1, 0.03)
        at(out, s, p * 1.2 + (0.0 if p % 2 == 0 else -0.6))
    return reverb(out, rng, 0.25, 0.1)


def notification(rng, style=0):
    styles = [
        [(1318.5, 0.0), (1760.0, 0.09)],
        [(987.8, 0.0), (1480.0, 0.07), (1975.5, 0.14)],
        [(1567.98, 0.0), (1174.66, 0.1)],
        [(880, 0.0), (1108.7, 0.06), (1318.5, 0.12), (1760, 0.18)],
        [(2093, 0.0)],
        [(659.25, 0.0), (987.77, 0.11)],
    ]
    notes = styles[style % len(styles)]
    out = np.zeros(n_of(1.0))
    for f, t0 in notes:
        d = 0.45
        s = (sine(f, n_of(d)) + 0.15 * sine(f * 3.01, n_of(d))) * env_perc(n_of(d), 0.002, 0.11)
        at(out, s, t0)
    return reverb(out, rng, 0.5, 0.18)


def text_typing(rng, sec=2.5, haptic=True):
    out = np.zeros(n_of(sec))
    t = 0.05
    while t < sec - 0.1:
        c = hp(noise(n_of(0.01), rng), 3000) * env_perc(n_of(0.01), 0.0003, 0.002) * 0.6
        if haptic:
            c = c + sine(180, n_of(0.01)) * env_perc(n_of(0.01), 0.0005, 0.004) * 0.5
        at(out, c, t)
        t += rng.uniform(0.07, 0.2) + (0.35 if rng.random() < 0.1 else 0)
    return out


def walkie_squelch(rng, talk=True):
    out = np.zeros(n_of(2.6 if talk else 0.8))
    burst = bp(noise(n_of(0.25), rng), 2200, 0.5) * env_adsr(n_of(0.25), 0.002, 0.05, 0.7, 0.05)
    at(out, burst, 0)
    if talk:
        v = to_mono(gibberish(rng, sec=1.6, pitch=130, rate=5, line=False))
        v = drive(bp(v, 1500, 0.9) * 2, 3)
        at(out, v + 0.05 * noise(len(v), rng), 0.2, 0.7)
        at(out, tones([1200], 0.1, 0.5), 1.9)  # roger beep
        at(out, burst * 0.8, 2.05)
    return out


def radio_tuning(rng, sec=4.0):
    n = n_of(sec)
    t = np.arange(n) / SR
    st = noise(n, rng)
    whistle = sine(curve([(0, 3000), (1.3, 900), (2.1, 1500), (3.0, 400), (sec, 2400)], sec)) * 0.25
    station = to_mono(gibberish(rng, sec=sec, pitch=110, rate=4.5, line=False))
    lock = np.exp(-((t - 2.2) ** 2) / 0.12)
    x = bp(st, 2000, 0.4) * (1 - lock) * 0.6 + whistle * (1 - lock) + bp(station, 1400, 0.6) * lock * 1.3
    return x


# =============================================================================================
# Voices: gibberish speech from a formant synthesizer. Every syllable is made up.

VOWELS = {  # F1, F2, F3 (Hz), adult male; scaled for higher voices
    "a": (730, 1090, 2440), "e": (530, 1840, 2480), "i": (270, 2290, 3010), "o": (570, 840, 2410),
    "u": (300, 870, 2240), "ae": (660, 1720, 2410), "uh": (520, 1190, 2390), "er": (490, 1350, 1690),
}


def glottal(f0: np.ndarray, rng) -> np.ndarray:
    """A buzzy pulse train with jitter, like vocal folds."""
    jitter = 1 + 0.01 * lp(rng.standard_normal(len(f0)), 30)
    ph = np.cumsum(f0 * jitter) / SR
    frac = ph % 1.0
    pulse = np.where(frac < 0.6, np.sin(np.pi * frac / 0.6) ** 2, 0) - 0.36
    return np.diff(pulse, prepend=0) * 40


def formant_voice(src: np.ndarray, f1, f2, f3, bw=(80, 100, 150)) -> np.ndarray:
    out = np.zeros_like(src)
    for f, b, g in ((f1, bw[0], 1.0), (f2, bw[1], 0.6), (f3, bw[2], 0.3)):
        out += blockfilter(src, f, "bp", q=np.mean(f) / b, block=256) * g
    return out


def gibberish(rng, sec=3.0, pitch=120.0, gender="m", rate=4.5, excited=False, line=False, shout=False):
    n = n_of(sec)
    scale = 1.0 if gender == "m" else 1.17
    t = np.arange(n) / SR
    # Syllable timeline: each syllable picks a vowel; consonants are noise or stop bursts.
    keys = list(VOWELS)
    f1 = np.zeros(n)
    f2 = np.zeros(n)
    f3 = np.zeros(n)
    amp = np.zeros(n)
    cons = np.zeros(n)
    pos = 0.05
    while pos < sec - 0.15:
        d = rng.uniform(0.6, 1.4) / rate
        if rng.random() < 0.12:  # a pause between phrases
            pos += rng.uniform(0.15, 0.35)
            continue
        v = VOWELS[keys[rng.integers(len(keys))]]
        s, e = n_of(pos), min(n, n_of(pos + d))
        f1[s:e], f2[s:e], f3[s:e] = v[0] * scale, v[1] * scale, v[2] * scale
        seg = e - s
        amp[s:e] = np.sin(np.linspace(0, np.pi, seg)) ** 0.6 * rng.uniform(0.6, 1)
        ck = rng.random()
        cn = min(seg, n_of(rng.uniform(0.02, 0.07)))
        if ck < 0.45:  # fricative s/sh/f
            fc = rng.choice([2500, 4500, 6500])
            cons[s : s + cn] += bp(noise(cn, rng), fc, 1.5) * 0.5
        elif ck < 0.75:  # stop burst p/t/k
            cons[s : s + min(cn, 300)] += hp(noise(min(cn, 300), rng), 1500) * np.exp(-np.arange(min(cn, 300)) / 60)
        pos += d
    for arr in (f1, f2, f3):
        nz = arr > 0
        if nz.any():
            arr[~nz] = np.interp(np.flatnonzero(~nz), np.flatnonzero(nz), arr[nz])
    f1, f2, f3 = lp(f1, 18), lp(f2, 18), lp(f3, 18)
    amp = lp(amp, 40)
    # Intonation: phrase declination plus wiggles; excited speech jumps around more.
    contour = 1 + (0.18 if excited else 0.08) * lp(rng.standard_normal(n), 3) * 6 - 0.12 * (t / sec)
    f0 = pitch * np.clip(contour, 0.6, 1.8) * (1.35 if shout else 1)
    src = glottal(f0, rng) + 0.03 * noise(n, rng)
    v = formant_voice(src, f1, f2, f3)
    v = v / (np.max(np.abs(v)) + 1e-9) * amp + cons * amp.max() * 0.4
    if shout:
        v = drive(peak(v, 2500, 1.0, 8) * 2.5, 3)
    if line:
        v = phone_line(v, rng)
    return v


def gibberish_pitched(rng, sec=3.0, shift=2.0, gender="m"):
    """Chipmunk (shift > 1) or demon (shift < 1) gibberish."""
    v = gibberish(rng, sec=sec, pitch=120 * shift, gender=gender, rate=4.5 * (shift**0.35))
    if shift < 1:
        v = drive(v * 1.5 + 0.5 * lp(v, 300), 1.5)
        return reverb(v, rng, 2.0, 0.4, damp=2000)
    return v


def crowd_murmur(rng, sec=8.0, voices=14, excited=False):
    out = np.zeros((n_of(sec), 2))
    for i in range(voices):
        g = "m" if rng.random() < 0.5 else "f"
        v = gibberish(rng, sec=sec, pitch=(110 if g == "m" else 200) * rng.uniform(0.85, 1.2), gender=g, rate=rng.uniform(3.5, 5.5), excited=excited)
        v = lp(v, rng.uniform(2500, 6000)) * rng.uniform(0.3, 1)
        out += pan(v, rng.uniform(-0.9, 0.9))
    return reverb(out, rng, 1.4, 0.5)


def robot_voice(rng, sec=3.0, pitch=95.0):
    v = gibberish(rng, sec=sec, pitch=pitch, rate=4)
    # Ring-mod and a flat pitch make it metallic.
    v = v * sine(pitch * 0.5, len(v)) * 0.7 + v * 0.3
    v = bitcrush(v, 10, 2)
    return reverb(v, rng, 0.6, 0.2)


def heartbeat(rng, sec=6.0, bpm=70.0, tense=False):
    out = np.zeros(n_of(sec))
    for k in np.arange(0.1, sec - 0.4, 60 / bpm):
        for off, g in ((0.0, 1.0), (0.22 if not tense else 0.18, 0.7)):
            d = 0.16
            thump = sine(curve([(0, 70), (d, 38)], d)) * env_perc(n_of(d), 0.006, 0.05) * g
            at(out, thump, k + off)
    out = lp(out, 180)
    return drive(out * 1.5, 1.5)


def breath(rng, sec=2.5, heavy=False):
    n = n_of(sec)
    t = np.arange(n) / SR
    cyc = 2.0 if not heavy else 1.1
    env = np.clip(np.sin(2 * np.pi * t / cyc), 0, 1) ** 1.5
    inhale = np.clip(-np.sin(2 * np.pi * t / cyc), 0, 1) ** 2 * 0.6
    x = bp(pink(n, rng), 1200, 0.5) * (env + inhale)
    return reverb(x, rng, 0.4, 0.15)


# =============================================================================================
# Vehicles


def engine(rng, rpm: np.ndarray, cyl=4, load: np.ndarray | None = None, rough=0.15, bright=1.0, exhaust=1.0) -> np.ndarray:
    """A combustion engine from its firing pulses: each cylinder fires once per two turns."""
    n = len(rpm)
    load = np.full(n, 0.5) if load is None else load
    fire = rpm / 60 * cyl / 2
    # Per-cylinder level differences give an uneven, lumpy idle.
    ph = np.cumsum(fire) / SR
    cyl_idx = np.floor(ph).astype(int) % cyl
    gains = 1 + rough * rng.standard_normal(cyl)
    frac = ph % 1
    pulse = np.exp(-frac * (6 + 10 * load)) * gains[cyl_idx]
    pulse = pulse - lp(pulse, 20)
    body = pulse + 0.4 * lp(rng.standard_normal(n), 3000) * pulse * load
    # Exhaust resonance and intake: cutoff rises with rpm and load.
    cut = 300 + 3200 * bright * (rpm / 9000) * (0.5 + load)
    x = blockfilter(body, cut, "lp", block=128)
    x = x + 0.25 * exhaust * blockfilter(body, cut * 0.4 + 60, "bp", q=1.2, block=128)
    # Mechanical whine of the drivetrain.
    x = x + 0.04 * bright * sine(rpm / 60 * 4.6) * load
    return drive(x * 2.5, 2.0)


def car_start(rng, cyl=4, idle=850, catches=True, rev_after=False):
    crank = 1.3 if catches else 2.6
    sec = crank + (3.5 if catches else 0.8) + (2.5 if rev_after else 0)
    n = n_of(sec)
    t = np.arange(n) / SR
    # Starter motor: a geared whine with compression lumps.
    sm = np.zeros(n)
    cn = n_of(crank)
    tt = t[:cn]
    lumps = 0.55 + 0.45 * np.sin(2 * np.pi * 4.2 * tt) ** 2
    motor = saw(curve([(0, 250), (0.2, 330), (crank, 340)], crank), harmonics=20) * lumps
    sm[:cn] = bp(motor, 900, 0.7) * 0.7 + lp(noise(cn, rng), 600) * lumps * 0.4
    sm[:cn] *= env_adsr(cn, 0.02, 0.05, 1, 0.05)
    if not catches:
        sm[n_of(crank):] = 0
        return reverb(sm, rng, 0.5, 0.15)
    rpm_pts = [(0, 0), (crank - 0.05, 200), (crank + 0.15, idle * 2.2), (crank + 0.9, idle * 1.3), (crank + 2.0, idle)]
    if rev_after:
        e = crank + 3.5
        rpm_pts += [(e - 0.5, idle), (e, idle * 4.5), (e + 0.5, idle * 2), (e + 1.0, idle * 5.5), (e + 1.8, idle)]
    rpm_pts += [(sec, idle)]
    rpm = curve(rpm_pts, sec)
    load = curve([(0, 0.2), (crank + 0.2, 0.9), (crank + 1.0, 0.3), (sec, 0.25)], sec)
    eng = engine(rng, np.maximum(rpm, 60), cyl=cyl, load=load)
    eng *= np.clip((t - crank + 0.1) / 0.08, 0, 1)
    return reverb(sm + eng * 0.9, rng, 0.6, 0.15)


def engine_rev(rng, cyl=8, idle=750, peak_rpm=6500, revs=2, bright=1.0, pops=True):
    sec = 1.0 + revs * 1.6 + 1.0
    pts = [(0, idle)]
    t0 = 0.6
    for r in range(revs):
        top = peak_rpm * (0.8 + 0.2 * r / max(1, revs - 1))
        pts += [(t0, idle), (t0 + 0.45, top), (t0 + 0.55, top * 0.97), (t0 + 1.4, idle * 1.1)]
        t0 += 1.6
    pts += [(sec, idle)]
    rpm = curve(pts, sec)
    load = np.clip(np.gradient(rpm) * SR / 12000, 0, 1) * 0.8 + 0.25
    load = lp(load, 8)
    x = engine(rng, rpm, cyl=cyl, load=load, bright=bright)
    if pops:  # overrun crackle as the revs fall
        fall = np.clip(-np.gradient(rpm) * SR / 9000, 0, 1)
        crack = (rng.random(len(x)) < 0.0009 * fall) * rng.uniform(0.5, 1, len(x))
        crack = signal.fftconvolve(crack, np.exp(-np.arange(400) / 60) * rng.standard_normal(400))[: len(x)]
        x = x + lp(crack, 3000) * 0.6
    return reverb(x, rng, 0.8, 0.18)


def supercar_flyby(rng, cyl=10, sec=6.0, rpm_hi=8200, shift=True):
    pts = [(0, 5200), (2.2, rpm_hi), (2.3, 6200 if shift else rpm_hi), (sec, rpm_hi * (0.95 if shift else 0.9))]
    rpm = curve(pts, sec)
    x = engine(rng, rpm, cyl=cyl, load=np.full(len(rpm), 0.95), bright=1.3)
    x = x + 0.25 * lp(noise(len(x), rng), 1200)  # tyre and wind roar
    x = doppler_pass(x, sec, speed=55, closest=6)
    return reverb(x, rng, 1.4, 0.25)


def car_passby(rng, sec=6.0, speed=22.0, cyl=4):
    rpm = np.full(n_of(sec), 2600.0) + 100 * lp(rng.standard_normal(n_of(sec)), 2)
    x = engine(rng, rpm, cyl=cyl, load=np.full(len(rpm), 0.45)) * 0.6 + 0.6 * lp(pink(len(rpm), rng), 900)
    return reverb(doppler_pass(x, sec, speed, 5), rng, 1.0, 0.2)


def engine_idle(rng, sec=6.0, cyl=8, idle=700, lope=0.35):
    n = n_of(sec)
    rpm = idle * (1 + 0.04 * lp(rng.standard_normal(n), 2) * 10)
    return reverb(engine(rng, rpm, cyl=cyl, load=np.full(n, 0.3), rough=lope), rng, 0.5, 0.12)


def tire_screech(rng, sec=2.5, pitch=1400.0):
    n = n_of(sec)
    t = np.arange(n) / SR
    f = pitch * (1 + 0.06 * np.sin(2 * np.pi * 7 * t)) * curve([(0, 1.0), (sec, 0.85)], sec)
    squeal = sum(sine(f * k) / k for k in (1, 2, 3)) * (0.6 + 0.4 * lp(rng.standard_normal(n), 30) * 4)
    grit = bp(noise(n, rng), pitch * 2, 1.0) * 0.5
    x = (squeal + grit) * env_adsr(n, 0.05, 0.1, 0.85, 0.4)
    return reverb(drive(x, 1.5), rng, 1.0, 0.25)


def car_horn(rng, kind="sedan", sec=0.9, beeps=1):
    out = np.zeros(n_of(beeps * (sec + 0.15)))
    fs = {"sedan": (420, 510), "truck": (280, 350), "small": (520, 620), "bike": (1900,)}[kind]
    for b in range(beeps):
        d = sec if beeps == 1 else 0.16
        s = sum(drive(square(f, n_of(d), harmonics=20), 2) for f in fs)
        s = bp(s, 1200 if kind != "truck" else 800, 0.5) * env_adsr(n_of(d), 0.01, 0.03, 0.9, 0.03)
        at(out, s, b * (d + 0.12))
    return reverb(out, rng, 1.0, 0.25)


def air_horn_truck(rng, sec=1.8):
    n = n_of(sec)
    f = curve([(0, 180), (0.12, 233), (sec, 228)], sec)
    x = saw(f, harmonics=60) + saw(f * 1.26, harmonics=50) * 0.7 + saw(f * 1.5, harmonics=40) * 0.5
    x = drive(bp(x, 900, 0.4), 2) * env_adsr(n, 0.06, 0.05, 0.9, 0.25)
    return reverb(x, rng, 2.0, 0.4)


def train_horn(rng, sec=2.5, chord=(277.18, 329.63, 392.0, 440.0, 554.37), distance=0.3):
    """A five-chime diesel horn: each bell is a reedy saw through its own resonance."""
    n = n_of(sec)
    x = np.zeros(n)
    for f in chord:
        ff = f * curve([(0, 0.92), (0.15, 1.0), (sec, 0.995)], sec)
        x += lp(saw(ff, harmonics=30), f * 5)
    x = drive(x * 0.6, 1.8) * env_adsr(n, 0.08, 0.05, 0.95, 0.3)
    x = lp(x, 5000 - 3000 * distance)
    return reverb(x, rng, 2.5 + 2 * distance, 0.35 + 0.35 * distance, damp=3500)


def steam_whistle(rng, sec=2.5):
    n = n_of(sec)
    f = curve([(0, 600), (0.2, 740), (sec, 735)], sec)
    x = sum(sine(f * r) / (1 + i) for i, r in enumerate((1, 1.25, 1.5))) + 0.3 * bp(noise(n, rng), 1500, 1)
    return reverb(x * env_adsr(n, 0.12, 0.05, 0.9, 0.3), rng, 2.5, 0.45)


def train_pass(rng, sec=14.0, speed=28.0, cars=12, horn=False):
    n = n_of(sec)
    t = np.arange(n) / SR
    rumble = lp(brown(n, rng), 300) * 1.4 + bp(pink(n, rng), 1200, 0.6) * 0.5
    # Wheel clacks over rail joints: pairs of hits per car, timed by speed.
    clack = np.zeros(n)
    car_len = 20.0
    joint_rate = speed / car_len
    for k in np.arange(0, sec, 1 / joint_rate):
        for off in (0.0, 2.6 / speed):
            i = int((k + off) * SR)
            if i < n - 2000:
                hit = bp(noise(2000, rng), rng.uniform(700, 1400), 1.5) * np.exp(-np.arange(2000) / 220)
                clack[i : i + 2000] += hit * rng.uniform(0.6, 1)
    src = rumble + clack * 1.2
    # A long source: the level rises as the train arrives, holds while cars pass, falls away.
    env = np.clip(t / (sec * 0.3), 0, 1) ** 2 * np.clip((sec - t) / (sec * 0.35), 0, 1) ** 1.5
    env = 0.05 + env
    x = src * env
    x = pan(x, np.clip((t - sec / 2) / (sec / 2), -0.8, 0.8))
    if horn:
        h = to_mono(train_horn(rng, 2.0, distance=0.4))
        at(x, pan(h, -0.5), sec * 0.15, 0.8)
    return reverb(x, rng, 1.6, 0.3)


def subway_brakes(rng, sec=4.0):
    n = n_of(sec)
    f = curve([(0, 2600), (sec, 2200)], sec)
    squeal = sine(f + 40 * np.sin(2 * np.pi * 5 * t_axis(sec))) * (0.5 + 0.5 * lp(rng.standard_normal(n), 10) * 3)
    hiss = hp(noise(n, rng), 3000) * curve([(0, 0), (sec - 1.0, 0), (sec - 0.9, 0.8), (sec, 0)], sec)
    rumble = lp(brown(n, rng), 200) * curve([(0, 1), (sec, 0.2)], sec)
    x = squeal * env_adsr(n, 0.3, 0.2, 0.8, 0.8) * 0.5 + rumble + hiss * 0.5
    return reverb(x, rng, 2.0, 0.45)


def jet_flyover(rng, sec=10.0):
    n = n_of(sec)
    roar = pink(n, rng) + 0.5 * brown(n, rng)
    whine = sine(curve([(0, 3800), (sec, 3200)], sec)) * 0.08
    x = doppler_pass(lp(roar, 6000) + whine, sec, speed=90, closest=60)
    return reverb(x, rng, 2.5, 0.35)


def helicopter(rng, sec=8.0, pass_by=True):
    n = n_of(sec)
    t = np.arange(n) / SR
    blade = 5.5
    chop = (np.sin(2 * np.pi * blade * t) > 0.6).astype(float)
    chop = lp(chop, 400)
    thump = lp(noise(n, rng), 300) * chop * 2 + sine(blade * 2, n) * 0.0
    turbine = bp(noise(n, rng), 3500, 3) * 0.25 + sine(curve([(0, 1150), (sec, 1150)], sec)) * 0.03
    x = thump + turbine
    if pass_by:
        return reverb(doppler_pass(x, sec, 40, 25), rng, 1.5, 0.3)
    return reverb(x, rng, 1.2, 0.2)


def boat_horn(rng, sec=3.5, f0=73.0):
    n = n_of(sec)
    f = curve([(0, f0 * 0.95), (0.3, f0), (sec, f0)], sec)
    x = saw(f, harmonics=80) + 0.5 * saw(f * 2.005, harmonics=40)
    x = drive(lp(x, 1800), 1.8) * env_adsr(n, 0.25, 0.1, 0.9, 0.6)
    return reverb(x, rng, 4.0, 0.55, damp=2500)


def motorcycle_rev(rng, revs=3):
    return engine_rev(rng, cyl=2, idle=1100, peak_rpm=9000, revs=revs, bright=1.4)


def dirtbike_pass(rng, sec=5.0):
    rpm = curve([(0, 7000), (1.8, 9500), (1.9, 7800), (sec, 9800)], sec)
    x = engine(rng, rpm, cyl=1, load=np.full(len(rpm), 0.9), bright=1.6)
    return reverb(doppler_pass(x, sec, 30, 4), rng, 0.9, 0.2)


def car_door(rng, kind="close"):
    n = n_of(0.6)
    thud = lp(noise(n, rng), 400) * env_perc(n, 0.002, 0.05) + sine(85, n) * env_perc(n, 0.002, 0.06) * 0.8
    latch = bp(noise(n_of(0.03), rng), 3000, 2) * env_perc(n_of(0.03), 0.0005, 0.006)
    out = np.zeros(n_of(0.9))
    if kind == "open":
        at(out, latch, 0.0, 0.8)
        at(out, lp(noise(n_of(0.3), rng), 2000) * env_adsr(n_of(0.3), 0.05, 0.1, 0.3, 0.1) * 0.2, 0.05)
    else:
        at(out, thud, 0.01)
        at(out, latch, 0.0, 0.6)
    return reverb(out, rng, 0.5, 0.15)


def lock_chirp(rng, count=2):
    out = np.zeros(n_of(0.3 + count * 0.25))
    for i in range(count):
        s = square(2850, n_of(0.08), harmonics=3) * env_adsr(n_of(0.08), 0.003, 0.01, 0.9, 0.01)
        at(out, s, i * 0.22)
    at(out, to_mono(car_door(rng, "open")) * 0.4, 0.02)
    return reverb(out, rng, 1.0, 0.3)


# =============================================================================================
# Impacts, transitions, weapons


def boom(rng, sec=3.0, f_hi=120.0, f_lo=32.0, dirt=0.3, verb=0.4):
    n = n_of(sec)
    body = sine(curve([(0, f_hi), (0.25, f_lo * 1.3), (sec, f_lo)], sec, "exp")) * env_perc(n, 0.002, sec * 0.35)
    click = lp(noise(n_of(0.05), rng), 5000) * env_perc(n_of(0.05), 0.0005, 0.01)
    x = body.copy()
    at(x, click, 0, 0.6)
    tail = lp(brown(n, rng), 400) * env_perc(n, 0.01, sec * 0.25) * dirt
    x = drive((x + tail) * 1.5, 1.5)
    return reverb(x, rng, 2.5, verb, damp=2500)


def cinematic_hit(rng, sec=4.0, metal=True):
    n = n_of(sec)
    x = to_mono(boom(rng, sec, 90, 30, 0.5, 0.0))[:n]
    x = np.pad(x, (0, n - len(x)))
    if metal:
        for f in rng.uniform(180, 2400, 9):
            x += sine(f, n) * env_perc(n, 0.001, rng.uniform(0.3, 1.5)) * 0.08
        x += bp(noise(n, rng), 3000, 0.8) * env_perc(n, 0.001, 0.15) * 0.5
    return reverb(x, rng, 3.5, 0.5, damp=4000)


def braam(rng, sec=4.0, root=55.0, dark=True):
    n = n_of(sec)
    x = np.zeros(n)
    for r, g in ((1, 1), (1.5, 0.6), (2, 0.5), (1.0045, 0.8), (0.5, 0.6)):
        x += saw(root * r * (1 + 0.003 * rng.standard_normal()), n, harmonics=60) * g
    cut = curve([(0, 300), (0.15, 2600 if not dark else 1600), (sec, 400)], sec)
    x = blockfilter(x, cut, "lp")
    x = drive(x * 1.5, 2.5) * env_adsr(n, 0.04, 0.4, 0.7, 1.5)
    return reverb(x, rng, 3.5, 0.45, damp=3000)


def sub_drop(rng, sec=2.5, f_hi=110.0, f_lo=28.0):
    n = n_of(sec)
    x = sine(curve([(0, f_hi), (sec, f_lo)], sec, "exp")) * env_adsr(n, 0.005, 0.2, 0.8, 0.6)
    return drive(x * 1.3, 1.4)


def riser(rng, sec=4.0, kind="noise"):
    n = n_of(sec)
    t = np.arange(n) / SR
    rise = (t / sec) ** 2
    if kind == "noise":
        x = blockfilter(noise(n, rng), 300 + 9000 * rise, "bp", q=1.2) * (0.2 + rise)
    elif kind == "tone":
        f = curve([(0, 110), (sec, 880)], sec, "exp")
        x = sum(saw(f * (1 + d), harmonics=30) for d in (-0.006, 0, 0.007)) / 3 * (0.15 + rise)
        x = blockfilter(x, 400 + 6000 * rise, "lp")
    else:  # shepard-ish stacked octaves
        x = np.zeros(n)
        for o in range(5):
            f = 55 * 2 ** (o + rise * 1.5)
            g = np.exp(-((np.log2(f / 440)) ** 2) / 2)
            x += sine(f) * g
        x *= 0.2 + rise
    x = x + blockfilter(noise(n, rng), 1000 + 10000 * rise, "hp") * rise * 0.3
    return reverb(x, rng, 2.0, 0.35)


def downlifter(rng, sec=3.0):
    n = n_of(sec)
    t = np.arange(n) / SR
    fall = 1 - t / sec
    x = blockfilter(noise(n, rng), 300 + 8000 * fall**2, "bp", q=1.0) * fall
    x += sine(curve([(0, 400), (sec, 40)], sec, "exp")) * fall * 0.6
    return reverb(x, rng, 2.0, 0.4)


def whoosh(rng, sec=1.2, bright=1.0):
    n = n_of(sec)
    t = np.arange(n) / SR
    shape = np.sin(np.pi * t / sec) ** 2
    x = blockfilter(noise(n, rng), 400 + 4000 * bright * shape, "bp", q=0.8) * shape
    return reverb(pan(x, np.linspace(-0.7, 0.7, n)), rng, 0.8, 0.2)


def reverse_cymbal(rng, sec=3.0):
    n = n_of(sec)
    cym = np.zeros(n)
    for f in rng.uniform(3000, 12000, 30):
        cym += sine(f, n) * rng.uniform(0.2, 1)
    cym = (cym / 30 + hp(noise(n, rng), 5000)) * env_perc(n, 0.001, sec * 0.3)
    return to_mono(reverb(cym, rng, 1.0, 0.3))[::-1][:n] if True else cym


def tape_stop(rng, sec=1.6, f0=110.0):
    # A falling chord whose pitch and speed both slow to nothing.
    n = n_of(sec)
    speed = curve([(0, 1), (sec, 0.02)], sec) ** 1.4
    x = sum(saw(f0 * r * speed, harmonics=30) for r in (1, 1.5, 2, 2.52)) / 4
    x = blockfilter(x, 300 + 3000 * speed, "lp") * env_adsr(n, 0.002, 0.0, 1, 0.1)
    return x


def vinyl_scratch(rng, sec=1.5, rate=4.0):
    n = n_of(sec)
    t = np.arange(n) / SR
    speed = np.sin(2 * np.pi * rate * t) * (1 + 0.3 * np.sin(2 * np.pi * rate * 0.5 * t))
    src_noise = pink(n * 4, rng)
    pos = np.cumsum(speed) * 2
    pos = np.clip(pos - pos.min(), 0, len(src_noise) - 1)
    y = np.interp(pos, np.arange(len(src_noise)), src_noise)
    tone = sine(np.abs(speed) * 380 + 20) * 0.6
    x = blockfilter(y * 0.6 + tone, 300 + 3500 * np.abs(speed), "bp", q=1.2)
    gate = (np.abs(speed) > 0.12).astype(float)
    return x * lp(gate, 200)


def glitch(rng, sec=1.5):
    n = n_of(sec)
    out = np.zeros(n)
    t = 0.0
    while t < sec - 0.05:
        d = rng.choice([0.015, 0.03, 0.06, 0.12])
        k = rng.integers(4)
        seg = n_of(d)
        if k == 0:
            s = square(rng.uniform(200, 3000), seg, harmonics=6)
        elif k == 1:
            s = bitcrush(noise(seg, rng), 4, 8)
        elif k == 2:
            s = sine(curve([(0, rng.uniform(2000, 6000)), (d, 100)], d))
        else:
            s = np.zeros(seg)
        reps = rng.integers(1, 4)
        for r in range(reps):
            at(out, s * 0.7, t + r * d)
        t += d * reps
    return pan(out, rng.uniform(-0.5, 0.5, 1)[0])


def gunshot(rng, kind="pistol", distance=0.0):
    n = n_of(2.5)
    crack = hp(noise(n_of(0.02), rng), 1500) * env_perc(n_of(0.02), 0.0002, 0.004)
    f_hi, dec = {"pistol": (180, 0.08), "rifle": (140, 0.12), "shotgun": (110, 0.18), "silenced": (300, 0.02)}[kind]
    body = (lp(noise(n, rng), 2500) * env_perc(n, 0.0005, dec) + sine(curve([(0, f_hi), (0.2, 50)], 2.5, "exp")) * env_perc(n, 0.001, dec * 1.3))
    x = body.copy()
    at(x, crack, 0, 1.5 if kind != "silenced" else 0.2)
    if kind == "silenced":
        x = lp(x, 1500) * 0.6 + bp(noise(n, rng), 2500, 1) * env_perc(n, 0.0005, 0.01) * 0.5
    x = drive(x * 2.5, 2.5)
    if distance:
        x = lp(x, 4000 - 3000 * distance)
    return reverb(x, rng, 1.8 + 2.0 * distance, 0.3 + 0.4 * distance, damp=4000)


def gun_cock(rng, kind="pump"):
    out = np.zeros(n_of(0.9))

    def click(f, d=0.025, g=1.0):
        return bp(noise(n_of(d), rng), f, 2.5) * env_perc(n_of(d), 0.0003, d / 5) * g + sine(f / 3, n_of(d)) * env_perc(n_of(d), 0.0003, d / 8) * g * 0.4

    if kind == "pump":
        at(out, click(2200), 0.0)
        at(out, bp(noise(n_of(0.12), rng), 1500, 1) * 0.25, 0.02)
        at(out, click(1800, 0.04, 1.3), 0.15)
        at(out, click(2500), 0.38)
        at(out, click(1700, 0.04, 1.2), 0.52)
    elif kind == "slide":
        at(out, click(3000), 0.0)
        at(out, bp(noise(n_of(0.08), rng), 2500, 1) * 0.2, 0.01)
        at(out, click(2600, 0.03, 1.3), 0.12)
    else:  # magazine
        at(out, click(1500, 0.05), 0.0)
        at(out, click(2200, 0.03, 1.4), 0.3)
    return reverb(out, rng, 0.4, 0.15)


def explosion(rng, sec=5.0, size=1.0):
    n = n_of(sec)
    crack = hp(noise(n, rng), 800) * env_perc(n, 0.001, 0.08)
    body = lp(brown(n, rng), 700) * env_perc(n, 0.01, 0.6 * size) * 2
    debris = np.zeros(n)
    for _ in range(int(40 * size)):
        t0 = rng.uniform(0.2, sec * 0.7)
        d = 0.03
        at(debris, bp(noise(n_of(d), rng), rng.uniform(1000, 5000), 2) * env_perc(n_of(d), 0.0005, 0.008) * rng.uniform(0.05, 0.3) * np.exp(-t0), t0)
    x = mix(to_mono(boom(rng, sec, 80, 25, 0.8, 0.0))[:n] * 0.8, body + crack + debris)
    return reverb(drive(x * 1.5, 2), rng, 3.5, 0.45, damp=2500)


def firework(rng, sec=4.0):
    out = np.zeros(n_of(sec))
    whistle = sine(curve([(0, 1200), (1.0, 3200)], 1.0)) * env_adsr(n_of(1.0), 0.05, 0, 0.6, 0.05) * 0.3
    at(out, whistle, 0)
    at(out, to_mono(gunshot(rng, "rifle", 0.3)), 1.05)
    for _ in range(80):
        t0 = 1.3 + rng.exponential(0.5)
        if t0 < sec - 0.05:
            at(out, hp(noise(n_of(0.01), rng), 2000) * env_perc(n_of(0.01), 0.0002, 0.002) * rng.uniform(0.1, 0.4), t0)
    return reverb(out, rng, 2.5, 0.45)


def punch(rng, heavy=True):
    n = n_of(0.5)
    x = lp(noise(n, rng), 1800) * env_perc(n, 0.001, 0.03) + sine(curve([(0, 160), (0.5, 50)], 0.5, "exp")) * env_perc(n, 0.001, 0.06) * (1.2 if heavy else 0.6)
    swish = to_mono(whoosh(rng, 0.25, 1.5)) * 0.4
    out = np.zeros(n_of(0.8))
    at(out, swish, 0)
    at(out, drive(x * 2, 2), 0.2)
    return reverb(out, rng, 0.6, 0.15)


# =============================================================================================
# Money


def cash_register(rng):
    out = np.zeros(n_of(2.5))
    keys = [0.0, 0.12, 0.25]
    for k in keys:
        at(out, bp(noise(n_of(0.03), rng), 2500, 2) * env_perc(n_of(0.03), 0.0005, 0.006), k)
    # drawer rattle and slam
    at(out, bp(noise(n_of(0.25), rng), 1200, 1) * env_adsr(n_of(0.25), 0.01, 0.05, 0.5, 0.1) * 0.5, 0.45)
    at(out, lp(noise(n_of(0.1), rng), 900) * env_perc(n_of(0.1), 0.001, 0.02), 0.7)
    # the "ching" bell
    n = n_of(1.6)
    bell = sum(sine(2093 * p, n) * env_perc(n, 0.001, 0.6 / (1 + i)) / (1 + i) for i, p in enumerate((1, 2.76, 5.4, 8.9)))
    at(out, bell, 0.72, 0.8)
    return reverb(out, rng, 0.9, 0.2)


def coin_drop(rng, count=1, surface="table"):
    out = np.zeros(n_of(1.2 + count * 0.15))
    for c in range(count):
        t0 = c * rng.uniform(0.05, 0.15)
        f = rng.uniform(4800, 6500)
        bounce_t = t0
        g = 1.0
        for b in range(6):
            d = 0.25
            ring = sum(sine(f * p, n_of(d)) * env_perc(n_of(d), 0.0003, 0.12 / (1 + i)) / (1 + i) for i, p in enumerate((1, 1.52, 2.33)))
            at(out, ring * g, bounce_t)
            bounce_t += 0.12 * (0.72**b)
            g *= 0.6
        if surface == "table":
            spin = sine(f, n_of(0.4)) * (0.5 + 0.5 * np.sin(2 * np.pi * curve([(0, 10), (0.4, 40)], 0.4) * t_axis(0.4))) * np.linspace(0.2, 0, n_of(0.4))
            at(out, spin, bounce_t)
    return reverb(out, rng, 0.5, 0.18)


def money_count(rng, sec=2.5, fast=True):
    """Bills riffling through a counting machine."""
    n = n_of(sec)
    t = np.arange(n) / SR
    rate = 22 if fast else 12
    flick = ((t * rate) % 1 < 0.35).astype(float)
    x = bp(noise(n, rng), 3200, 0.8) * lp(flick, 300) + lp(sine(95, n) * 0.15 + noise(n, rng) * 0.05, 300)
    return x * env_adsr(n, 0.05, 0, 1, 0.1)


def money_bag(rng):
    out = np.zeros(n_of(1.2))
    for _ in range(40):
        t0 = rng.uniform(0, 0.4)
        f = rng.uniform(3500, 7000)
        at(out, sine(f, n_of(0.12)) * env_perc(n_of(0.12), 0.0005, 0.03) * rng.uniform(0.1, 0.3), t0)
    at(out, lp(noise(n_of(0.15), rng), 600) * env_perc(n_of(0.15), 0.002, 0.04), 0.35)
    return reverb(out, rng, 0.5, 0.15)


# =============================================================================================
# Ambience and nature


def rain(rng, sec=10.0, heavy=0.5, roof=False):
    n = n_of(sec)
    bed = lp(pink(n, rng), 5000 + 4000 * heavy) * (0.4 + heavy)
    drops = np.zeros(n)
    rate = 200 + 1500 * heavy
    k = int(rate * sec)
    idx = rng.integers(0, n - 300, k)
    for i in idx[: min(k, 6000)]:
        f = rng.uniform(1500, 6000) if not roof else rng.uniform(600, 2000)
        drops[i : i + 200] += np.sin(2 * np.pi * f * np.arange(200) / SR) * np.exp(-np.arange(200) / 25) * rng.uniform(0.05, 0.25)
    x = np.stack([bed + drops, np.roll(bed, 1234) + np.roll(drops, 4321)], axis=1)
    return x


def thunder(rng, sec=8.0, close=True):
    n = n_of(sec)
    t = np.arange(n) / SR
    rumble = lp(brown(n, rng), 200 if not close else 500)
    env = np.exp(-t / (sec * 0.35)) * (0.6 + 0.4 * lp(np.abs(rng.standard_normal(n)), 3) * 3)
    x = rumble * env
    if close:
        at(x, hp(noise(n_of(0.3), rng), 600) * env_perc(n_of(0.3), 0.001, 0.05) * 1.5, 0.0)
    return reverb(x, rng, 3.0, 0.5, damp=1500)


def wind(rng, sec=10.0, howl=True):
    n = n_of(sec)
    gust = 0.4 + 0.6 * np.clip(lp(rng.standard_normal(n), 0.5) * 8 + 0.5, 0, 1.2)
    x = blockfilter(pink(n, rng), 300 + 900 * gust, "bp", q=1.0) * gust
    if howl:
        x += blockfilter(noise(n, rng), 500 + 700 * gust, "bp", q=12) * gust * 0.6
    return np.stack([x, np.roll(x, 8000)], axis=1)


def fire_crackle(rng, sec=10.0):
    n = n_of(sec)
    bed = lp(brown(n, rng), 300) * 0.6 + bp(pink(n, rng), 1200, 0.7) * 0.2
    pops = np.zeros(n)
    for _ in range(int(sec * 25)):
        i = rng.integers(0, n - 400)
        pops[i : i + 400] += hp(noise(400, rng), 1500) * np.exp(-np.arange(400) / rng.uniform(15, 80)) * rng.uniform(0.1, 1) ** 2
    return np.stack([bed + pops, bed + np.roll(pops, 3000)], axis=1)


def ocean(rng, sec=12.0):
    n = n_of(sec)
    t = np.arange(n) / SR
    swell = (0.5 + 0.5 * np.sin(2 * np.pi * t / 6.0 - np.pi / 2)) ** 2
    x = blockfilter(pink(n, rng), 300 + 3500 * swell, "lp") * (0.2 + swell)
    return np.stack([x, np.roll(x, 6000)], axis=1)


def stream(rng, sec=10.0):
    n = n_of(sec)
    bed = bp(pink(n, rng), 1800, 0.5) * 0.5
    bub = np.zeros(n)
    for _ in range(int(sec * 60)):
        i = rng.integers(0, n - 1500)
        f0 = rng.uniform(400, 1600)
        seg = sine(np.linspace(f0, f0 * 1.8, 1500)) * np.exp(-np.arange(1500) / 300) * rng.uniform(0.05, 0.25)
        bub[i : i + 1500] += seg
    return np.stack([bed + bub, bed + np.roll(bub, 5000)], axis=1)


def city_night(rng, sec=12.0):
    n = n_of(sec)
    traffic = lp(pink(n, rng), 900) * 0.5
    x = pan(traffic, -0.2) + pan(np.roll(traffic, 7000), 0.3)
    s = to_stereo(siren_wail(rng, 6.0, distance=1.0))
    x[n_of(3.0) : n_of(3.0) + len(s)] += s[: n - n_of(3.0)] * 0.25
    h = to_stereo(car_horn(rng, "sedan", 0.4, 2))
    x[n_of(1.5) : n_of(1.5) + len(h)] += lp(h, 2500) * 0.25
    return reverb(x, rng, 2.0, 0.4)


def crickets(rng, sec=10.0):
    n = n_of(sec)
    out = np.zeros((n, 2))
    for _ in range(8):
        f = rng.uniform(4200, 5200)
        rate = rng.uniform(2.5, 4)
        t = np.arange(n) / SR
        chirp_on = ((t * rate + rng.random()) % 1 < 0.18)
        pulses = (np.sin(2 * np.pi * 40 * t) > 0)
        s = sine(f, n) * chirp_on * pulses * rng.uniform(0.1, 0.4)
        out += pan(lp(s, 7000), rng.uniform(-1, 1))
    return out + to_stereo(lp(pink(n, rng), 600) * 0.05)


# =============================================================================================
# Sci-fi and game


def laser(rng, f_hi=2400.0, f_lo=300.0, sec=0.35, kind="zap"):
    n = n_of(sec)
    f = curve([(0, f_hi), (sec, f_lo)], sec, "exp")
    if kind == "zap":
        x = square(f, harmonics=8) * 0.6 + sine(f * 1.5) * 0.4
    else:
        x = sine(f + 300 * np.sin(2 * np.pi * 40 * t_axis(sec)))
    return reverb(x * env_perc(n, 0.002, sec / 3), rng, 0.8, 0.2)


def power_up(rng, sec=1.2, chip=True):
    n = n_of(sec)
    f = curve([(0, 220), (sec, 1760)], sec, "exp")
    arp = f * np.where((t_axis(sec) * 24) % 1 < 0.5, 1, 1.5)
    x = (square(arp, harmonics=6) if chip else sine(arp)) * env_adsr(n, 0.01, 0, 1, 0.1)
    return bitcrush(x, 6, 2) * 0.6 if chip else x


def coin_pickup(rng):
    out = np.zeros(n_of(0.5))
    at(out, square(987.77, n_of(0.07), harmonics=6), 0)
    at(out, square(1318.5, n_of(0.35), harmonics=6) * env_perc(n_of(0.35), 0.001, 0.12), 0.07)
    return bitcrush(out, 6, 2) * 0.6


def jump(rng):
    sec = 0.3
    return square(curve([(0, 300), (sec, 900)], sec), harmonics=6) * env_adsr(n_of(sec), 0.002, 0.05, 0.7, 0.08) * 0.6


def game_over(rng):
    out = np.zeros(n_of(2.2))
    for i, f in enumerate([523.25, 493.88, 466.16, 440.0]):
        d = 0.35 if i < 3 else 1.0
        tt = t_axis(d)
        at(out, square(f * (1 + 0.01 * np.sin(2 * np.pi * 6 * tt)), harmonics=6) * env_adsr(len(tt), 0.005, 0.05, 0.8, 0.1), i * 0.38)
    return bitcrush(out, 6, 2) * 0.6


def teleport(rng, sec=1.8):
    n = n_of(sec)
    f = curve([(0, 200), (sec * 0.6, 2400), (sec, 3800)], sec, "exp")
    x = sine(f + 400 * np.sin(2 * np.pi * 30 * t_axis(sec))) * env_adsr(n, 0.1, 0.2, 0.7, 0.5)
    x += blockfilter(noise(n, rng), f, "bp", q=4) * 0.4
    return reverb(x, rng, 2.0, 0.4)


def ufo(rng, sec=5.0):
    n = n_of(sec)
    t = t_axis(sec)
    f = 600 + 300 * np.sin(2 * np.pi * 0.7 * t) + 80 * np.sin(2 * np.pi * 9 * t)
    x = sine(f) * 0.7 + sine(f * 1.501) * 0.3
    return reverb(pan(x, np.sin(2 * np.pi * 0.25 * t) * 0.8), rng, 2.0, 0.4)


def computer_beeps(rng, sec=3.0):
    out = np.zeros(n_of(sec))
    t = 0.0
    while t < sec - 0.1:
        d = rng.choice([0.04, 0.06, 0.08])
        at(out, sine(rng.choice([880, 1320, 1760, 2200, 2640]), n_of(d)) * env_adsr(n_of(d), 0.002, 0, 1, 0.004) * 0.5, t)
        t += d + rng.choice([0.02, 0.05, 0.1])
    return reverb(out, rng, 0.4, 0.12)


def modem(rng, sec=6.0):
    """An original dial-up style handshake: tones, chirps and a noisy data burst."""
    out = np.zeros(n_of(sec))
    at(out, dtmf_dial(rng, "18005550199", 0.07, 0.05, line=False), 0)
    t0 = 1.5
    at(out, tones([2100], 0.9, 0.5), t0)
    at(out, sine(curve([(0, 1200), (0.5, 2400)], 0.5)) * 0.4, t0 + 1.0)
    burst = bp(noise(n_of(1.2), rng), 1800, 0.5) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 50 * t_axis(1.2)))) * 0.6
    at(out, burst, t0 + 1.6)
    at(out, (square(980, n_of(1.0), harmonics=5) * 0.3 + bp(noise(n_of(1.0), rng), 2500, 1) * 0.4), t0 + 2.9)
    return phone_line(out, rng, 0.01)


def radio_static(rng, sec=5.0):
    n = n_of(sec)
    t = t_axis(sec)
    x = bp(noise(n, rng), 2500, 0.3) * (0.6 + 0.4 * lp(np.abs(rng.standard_normal(n)), 15) * 3)
    crackle = (rng.random(n) < 0.002) * rng.uniform(-1, 1, n) * 3
    return x + crackle + 0.05 * sine(60, n) * (np.sin(2 * np.pi * 0.3 * t) > 0)


def vinyl_crackle(rng, sec=8.0):
    n = n_of(sec)
    hiss = hp(pink(n, rng), 1500) * 0.06
    pops = np.zeros(n)
    for _ in range(int(sec * 18)):
        i = rng.integers(0, n - 200)
        pops[i : i + 200] += hp(noise(200, rng), 2000) * np.exp(-np.arange(200) / rng.uniform(4, 30)) * rng.uniform(0.05, 1) ** 3
    thump = np.zeros(n)
    for k in np.arange(0, sec, 60 / 33.333):
        at(thump, lp(noise(n_of(0.05), rng), 120) * env_perc(n_of(0.05), 0.002, 0.02) * 0.15, k)
    return np.stack([hiss + pops + thump, np.roll(hiss, 900) + np.roll(pops, 7000) + thump], axis=1)


# =============================================================================================
# Foley


def door_knock(rng, knocks=3, heavy=False):
    out = np.zeros(n_of(0.4 + knocks * 0.2))
    for k in range(knocks):
        n = n_of(0.15)
        x = bp(noise(n, rng), 450 if heavy else 900, 1.2) * env_perc(n, 0.001, 0.02) + sine(160 if heavy else 240, n) * env_perc(n, 0.001, 0.025) * 0.8
        at(out, x * rng.uniform(0.8, 1), k * rng.uniform(0.16, 0.22))
    return reverb(out, rng, 0.9, 0.3)


def door_slam(rng):
    n = n_of(1.0)
    x = lp(noise(n, rng), 600) * env_perc(n, 0.001, 0.07) * 1.5 + sine(curve([(0, 110), (1.0, 60)], 1.0)) * env_perc(n, 0.001, 0.1)
    x += bp(noise(n, rng), 2500, 2) * env_perc(n, 0.0005, 0.01) * 0.5
    return reverb(drive(x * 2, 2), rng, 1.6, 0.4)


def door_creak(rng, sec=2.5):
    n = n_of(sec)
    t = t_axis(sec)
    f = curve([(0, 180), (sec * 0.5, 320), (sec, 260)], sec)
    # Stick-slip: pulses at a wandering rate excite the wood.
    slip = (np.sin(2 * np.pi * np.cumsum(f * (1 + 0.1 * lp(rng.standard_normal(n), 8) * 5)) / SR) > 0.95).astype(float)
    x = blockfilter(slip, 800 + 600 * np.sin(np.pi * t / sec), "bp", q=4) * np.sin(np.pi * t / sec)
    return reverb(x, rng, 0.8, 0.25)


def glass_break(rng, big=False):
    n = n_of(2.0)
    x = hp(noise(n, rng), 2000) * env_perc(n, 0.0005, 0.03) * 1.2
    for _ in range(25 if not big else 60):
        t0 = rng.exponential(0.25)
        if t0 < 1.8:
            f = rng.uniform(2500, 9000)
            d = rng.uniform(0.05, 0.3)
            at(x, sine(f, n_of(d)) * env_perc(n_of(d), 0.0003, d / 4) * rng.uniform(0.1, 0.4), t0)
    at(x, lp(noise(n, rng), 300) * env_perc(n, 0.001, 0.04), 0, 0.6 if big else 0.3)
    return reverb(x, rng, 1.0, 0.25)


def clock_tick(rng, sec=6.0, rate=1.0):
    out = np.zeros(n_of(sec))
    for i, k in enumerate(np.arange(0.05, sec - 0.05, 1 / rate)):
        f = 3500 if i % 2 == 0 else 3100
        at(out, bp(noise(n_of(0.02), rng), f, 4) * env_perc(n_of(0.02), 0.0003, 0.003), k)
    return reverb(out, rng, 0.5, 0.2)


def typewriter(rng, sec=4.0):
    out = np.zeros(n_of(sec))
    t = 0.05
    i = 0
    while t < sec - 0.6:
        at(out, bp(noise(n_of(0.03), rng), rng.uniform(1500, 2500), 2) * env_perc(n_of(0.03), 0.0005, 0.006) + sine(300, n_of(0.03)) * env_perc(n_of(0.03), 0.0005, 0.006) * 0.4, t)
        t += rng.uniform(0.08, 0.2)
        i += 1
    n = n_of(0.5)
    ding = sum(sine(3200 * p, n) * env_perc(n, 0.001, 0.25 / (1 + j)) / (1 + j) for j, p in enumerate((1, 2.7)))
    at(out, ding, sec - 0.55, 0.5)
    return reverb(out, rng, 0.6, 0.18)


def footsteps(rng, sec=4.0, surface="concrete", rate=1.9):
    out = np.zeros(n_of(sec))
    for k in np.arange(0.1, sec - 0.2, 1 / rate):
        n = n_of(0.12)
        f = {"concrete": 1100, "wood": 600, "gravel": 2500}[surface]
        heel = bp(noise(n, rng), f, 1.5) * env_perc(n, 0.001, 0.015)
        if surface == "gravel":
            heel = heel + bp(noise(n, rng), 4000, 1) * env_adsr(n, 0.005, 0.05, 0.3, 0.05) * 0.6
        at(out, heel * rng.uniform(0.7, 1), k + rng.uniform(-0.01, 0.01))
    return reverb(out, rng, 1.0, 0.3)


def zipper(rng, sec=0.8):
    n = n_of(sec)
    t = t_axis(sec)
    rate = curve([(0, 150), (sec, 400)], sec)
    teeth = (np.sin(2 * np.pi * np.cumsum(rate) / SR) > 0.7).astype(float)
    return bp(teeth * noise(n, rng) + teeth * 0.3, 3000, 1.2) * np.sin(np.pi * t / sec)


def lighter(rng):
    out = np.zeros(n_of(1.5))
    at(out, bp(noise(n_of(0.05), rng), 3500, 2) * env_perc(n_of(0.05), 0.0005, 0.01), 0.0)
    at(out, hp(noise(n_of(0.2), rng), 2000) * env_perc(n_of(0.2), 0.001, 0.05) * 0.5, 0.02)
    at(out, lp(pink(n_of(1.0), rng), 800) * env_adsr(n_of(1.0), 0.05, 0.1, 0.5, 0.2) * 0.5, 0.15)
    return out


def can_open(rng):
    out = np.zeros(n_of(1.2))
    at(out, bp(noise(n_of(0.02), rng), 2000, 2) * env_perc(n_of(0.02), 0.0003, 0.004), 0.0)
    at(out, hp(noise(n_of(0.4), rng), 3000) * env_perc(n_of(0.4), 0.002, 0.1), 0.02)
    for _ in range(40):
        t0 = 0.1 + rng.exponential(0.25)
        if t0 < 1.1:
            at(out, sine(rng.uniform(3000, 8000), n_of(0.004)) * rng.uniform(0.02, 0.08), t0)
    return reverb(out, rng, 0.4, 0.15)


# =============================================================================================
# The library. (category, subcategory, name, recipe, params, tags)

def _v(*args):
    return args


SOUNDS: list[tuple] = [
    # Sirens and alarms / Police
    _v("sirens", "police", "Police siren wail, close", siren_wail, {}, ["police", "wail", "cops", "drill"]),
    _v("sirens", "police", "Police siren wail, down the block", siren_wail, {"distance": 0.6}, ["police", "distant"]),
    _v("sirens", "police", "Police siren wail, far off at night", siren_wail, {"distance": 1.0, "sec": 8.0}, ["police", "distant", "night"]),
    _v("sirens", "police", "Police car passing with siren", siren_wail, {"doppler": True, "sec": 7.0}, ["police", "pass-by", "doppler"]),
    _v("sirens", "police", "Police yelp", siren_yelp, {}, ["police", "yelp", "fast"]),
    _v("sirens", "police", "Police yelp, distant", siren_yelp, {"distance": 0.8, "sec": 5.0}, ["police", "yelp", "distant"]),
    _v("sirens", "police", "Police wail to yelp switch", lambda rng: np.concatenate([to_mono(siren_wail(rng, 3.2)), to_mono(siren_yelp(rng, 3.0))]), {}, ["police", "chase"]),
    _v("sirens", "police", "Police chirp, pull over", lambda rng: to_mono(siren_yelp(rng, 0.5, rate=6)) * 1, {}, ["police", "chirp", "short"]),
    _v("sirens", "police", "European police hi-lo", siren_hilo, {"a": 466, "b": 622}, ["police", "europe", "two-tone", "uk drill"]),
    _v("sirens", "police", "European police hi-lo passing", siren_hilo, {"a": 466, "b": 622, "doppler": True, "sec": 7.0}, ["police", "europe", "pass-by"]),
    # Ambulance and fire
    _v("sirens", "ambulance-fire", "Ambulance hi-lo", siren_hilo, {}, ["ambulance", "two-tone"]),
    _v("sirens", "ambulance-fire", "Ambulance hi-lo, distant", siren_hilo, {"distance": 0.9, "sec": 8.0}, ["ambulance", "distant"]),
    _v("sirens", "ambulance-fire", "Ambulance passing", siren_hilo, {"doppler": True, "sec": 7.0}, ["ambulance", "pass-by"]),
    _v("sirens", "ambulance-fire", "Fire truck wail, low", siren_wail, {"lo": 420, "hi": 1050, "period": 4.5, "sec": 9.0, "tone": "saw"}, ["fire truck", "wail"]),
    _v("sirens", "ambulance-fire", "Fire truck air horn", air_horn_truck, {}, ["fire truck", "horn"]),
    _v("sirens", "ambulance-fire", "Fire alarm, temporal three", fire_alarm_horn, {}, ["fire alarm", "building"]),
    _v("sirens", "ambulance-fire", "Fire alarm, fast pulse", fire_alarm_horn, {"temporal": False, "sec": 3.0}, ["fire alarm"]),
    _v("sirens", "ambulance-fire", "Fire alarm bell", bell_ringer, {"sec": 5.0, "f0": 1500}, ["fire alarm", "bell"]),
    # Air raid and warning
    _v("sirens", "air-raid", "Air raid siren", air_raid, {}, ["air raid", "war", "warning", "dark"]),
    _v("sirens", "air-raid", "Air raid siren, close", air_raid, {"distance": 0.1, "sec": 12.0}, ["air raid", "close"]),
    _v("sirens", "air-raid", "Air raid siren, distant city", air_raid, {"distance": 1.0, "sec": 16.0, "top": 430}, ["air raid", "distant"]),
    _v("sirens", "air-raid", "Tornado siren, rotating", tornado_siren, {}, ["tornado", "warning", "rotating"]),
    _v("sirens", "air-raid", "Klaxon, a-oo-ga", klaxon, {}, ["klaxon", "horn", "cartoon"]),
    _v("sirens", "air-raid", "Submarine dive alarm", submarine_dive, {}, ["submarine", "alarm", "navy"]),
    _v("sirens", "air-raid", "Nuclear alert klaxon", klaxon, {"f0": 220, "beats": 4, "gap": 0.15}, ["alarm", "warning", "dark"]),
    # Alarm clocks
    _v("sirens", "alarm-clocks", "Digital alarm clock beeps", digital_alarm, {}, ["alarm clock", "morning", "beep"]),
    _v("sirens", "alarm-clocks", "Digital alarm, double beep", digital_alarm, {"pattern": "double", "f0": 3200}, ["alarm clock", "beep"]),
    _v("sirens", "alarm-clocks", "Digital alarm, long beeps", digital_alarm, {"pattern": "long", "f0": 2600}, ["alarm clock", "beep"]),
    _v("sirens", "alarm-clocks", "Twin bell alarm clock", alarm_clock_bell, {}, ["alarm clock", "bell", "wake up"]),
    _v("sirens", "alarm-clocks", "School bell", school_bell, {}, ["school", "bell"]),
    _v("sirens", "alarm-clocks", "Boxing ring bell", lambda rng: bell_ringer(rng, 1.4, 1300, 6, (1, 2.4, 3.9), 1.2), {}, ["boxing", "bell", "round"]),
    # Buzzers and beeps
    _v("sirens", "buzzers", "Game show wrong answer", buzzer, {"kind": "wrong"}, ["buzzer", "wrong", "fail"]),
    _v("sirens", "buzzers", "Game show right answer", buzzer, {"kind": "correct"}, ["ding", "correct"]),
    _v("sirens", "buzzers", "Shot clock horn", buzzer, {"kind": "shot-clock"}, ["buzzer", "basketball", "horn"]),
    _v("sirens", "buzzers", "Store door chime", buzzer, {"kind": "chime"}, ["chime", "doorbell", "store"]),
    _v("sirens", "buzzers", "Truck backing up beeps", backup_beeper, {}, ["truck", "reverse", "beep"]),
    _v("sirens", "buzzers", "Heart monitor", heart_monitor, {}, ["hospital", "ecg", "beep"]),
    _v("sirens", "buzzers", "Heart monitor flatline", heart_monitor, {"sec": 7.0, "flatline_at": 3.0}, ["hospital", "flatline", "dark"]),
    _v("sirens", "buzzers", "Microwave done beeps", lambda rng: digital_alarm(rng, 2.0, 2000, "double") * 1, {}, ["microwave", "kitchen", "beep"]),
    # Car alarms
    _v("sirens", "car-alarms", "Car alarm, full cycle", car_alarm, {}, ["car alarm", "street"]),
    _v("sirens", "car-alarms", "Car alarm, short", car_alarm, {"sec": 3.0}, ["car alarm"]),
    _v("sirens", "car-alarms", "Car lock chirp", lock_chirp, {"count": 1}, ["car", "lock", "chirp"]),
    _v("sirens", "car-alarms", "Car unlock double chirp", lock_chirp, {"count": 2}, ["car", "unlock", "chirp"]),

    # Phones and voicemail / Rings
    _v("phones", "rings", "Old phone bell ringing", old_phone_bell, {}, ["phone", "ring", "vintage", "landline"]),
    _v("phones", "rings", "Old phone bell, one ring", old_phone_bell, {"rings": 1}, ["phone", "ring", "vintage"]),
    _v("phones", "rings", "Office phone trill", trill_ring, {}, ["phone", "office", "trill"]),
    _v("phones", "rings", "Office phone trill, fast", trill_ring, {"rate": 24, "f1": 1400, "f2": 1800}, ["phone", "trill"]),
    _v("phones", "rings", "Marimba ringtone", marimba_ring, {"seed_melody": 0}, ["ringtone", "marimba", "cell"]),
    _v("phones", "rings", "Marimba ringtone two", marimba_ring, {"seed_melody": 1}, ["ringtone", "marimba"]),
    _v("phones", "rings", "Minor ringtone", marimba_ring, {"seed_melody": 2, "tempo": 130}, ["ringtone", "dark"]),
    _v("phones", "rings", "Phone vibrating on a table", vibrate, {}, ["vibrate", "buzz", "cell", "trap"]),
    _v("phones", "rings", "Phone vibrating in a pocket", vibrate, {"table": False}, ["vibrate", "buzz"]),
    _v("phones", "rings", "Ringback, US", ringback_us, {}, ["ringing", "calling", "dialing out"]),
    _v("phones", "rings", "Ringback, UK double ring", ringback_uk, {}, ["ringing", "uk"]),
    # Dial and line tones
    _v("phones", "line-tones", "Dial tone", dial_tone, {}, ["dial tone", "landline"]),
    _v("phones", "line-tones", "Dial tone, Europe", dial_tone, {"us": False}, ["dial tone"]),
    _v("phones", "line-tones", "Busy signal", busy_signal, {}, ["busy", "engaged"]),
    _v("phones", "line-tones", "Fast busy, all circuits", busy_signal, {"fast": True, "cycles": 10}, ["busy", "reorder"]),
    _v("phones", "line-tones", "Off the hook howler", off_hook_howler, {}, ["off hook", "alarm"]),
    _v("phones", "line-tones", "Number not in service tones", intercept_tones, {"then_voice": False}, ["intercept", "disconnected", "error"]),
    _v("phones", "line-tones", "Not in service tones and voice", intercept_tones, {}, ["intercept", "disconnected", "voice"]),
    _v("phones", "line-tones", "Hang up and dial tone", hang_up, {}, ["hang up", "click"]),
    _v("phones", "line-tones", "Hang up click", hang_up, {"then_tone": False}, ["hang up", "click"]),
    _v("phones", "line-tones", "Dial-up modem handshake", modem, {}, ["modem", "internet", "retro"]),
    # Voicemail
    _v("phones", "voicemail", "Voicemail beep", voicemail_beep, {"kind": "long"}, ["voicemail", "beep", "leave a message"]),
    _v("phones", "voicemail", "Answering machine beeps", voicemail_beep, {"kind": "machine"}, ["answering machine", "beep", "retro"]),
    _v("phones", "voicemail", "New message chime", voicemail_beep, {"kind": "new"}, ["voicemail", "chime"]),
    _v("phones", "voicemail", "End of message tones", voicemail_beep, {"kind": "end"}, ["voicemail", "end"]),
    _v("phones", "voicemail", "Voicemail, calm guy (gibberish)", voicemail_message, {"gender": "m"}, ["voicemail", "skit", "intro", "talking"]),
    _v("phones", "voicemail", "Voicemail, calm woman (gibberish)", voicemail_message, {"gender": "f"}, ["voicemail", "skit", "intro"]),
    _v("phones", "voicemail", "Voicemail, angry guy (gibberish)", voicemail_message, {"gender": "m", "mood": "angry", "sec": 8.0}, ["voicemail", "skit", "angry"]),
    _v("phones", "voicemail", "Voicemail, excited woman (gibberish)", voicemail_message, {"gender": "f", "mood": "angry", "sec": 8.0}, ["voicemail", "skit", "excited"]),
    _v("phones", "voicemail", "Phone call voice, guy (gibberish)", lambda rng: gibberish(rng, 5.0, 115, "m", 4.2, line=True), {}, ["phone call", "skit", "intro"]),
    _v("phones", "voicemail", "Phone call voice, woman (gibberish)", lambda rng: gibberish(rng, 5.0, 205, "f", 4.6, line=True), {}, ["phone call", "skit"]),
    # Dialing
    _v("phones", "dialing", "Touch-tone dialing a number", dtmf_dial, {}, ["dtmf", "dialing", "keypad"]),
    _v("phones", "dialing", "Touch-tone, fast", dtmf_dial, {"digits": "2125550188", "on": 0.07, "gap": 0.05}, ["dtmf", "dialing"]),
    _v("phones", "dialing", "Touch-tone, single key", dtmf_dial, {"digits": "5"}, ["dtmf", "key"]),
    _v("phones", "dialing", "Rotary dial", rotary_dial, {}, ["rotary", "vintage", "dialing"]),
    _v("phones", "dialing", "Texting on a phone", text_typing, {}, ["typing", "text", "keyboard"]),
    # Notifications
    _v("phones", "notifications", "Text message ding", notification, {"style": 0}, ["text", "notification", "ding"]),
    _v("phones", "notifications", "Notification, rising", notification, {"style": 1}, ["notification"]),
    _v("phones", "notifications", "Notification, falling", notification, {"style": 2}, ["notification"]),
    _v("phones", "notifications", "Notification, arpeggio", notification, {"style": 3}, ["notification", "chime"]),
    _v("phones", "notifications", "Notification, single ping", notification, {"style": 4}, ["ping", "notification"]),
    _v("phones", "notifications", "Notification, fifth", notification, {"style": 5}, ["notification"]),
    # Radio and walkie
    _v("phones", "radio", "Walkie-talkie with voice (gibberish)", walkie_squelch, {}, ["walkie", "radio", "police radio"]),
    _v("phones", "radio", "Walkie-talkie squelch", walkie_squelch, {"talk": False}, ["walkie", "squelch"]),
    _v("phones", "radio", "Radio tuning to a station", radio_tuning, {}, ["radio", "tuning", "intro"]),
    _v("phones", "radio", "Radio static", radio_static, {}, ["static", "radio", "noise"]),

    # Vehicles / Cars
    _v("vehicles", "cars", "Car starting, four cylinder", car_start, {}, ["car", "start", "ignition"]),
    _v("vehicles", "cars", "Car starting and revving", car_start, {"cyl": 6, "idle": 750, "rev_after": True}, ["car", "start", "rev"]),
    _v("vehicles", "cars", "Car won't start", car_start, {"catches": False}, ["car", "start", "fail"]),
    _v("vehicles", "cars", "V8 muscle car start", car_start, {"cyl": 8, "idle": 700}, ["car", "v8", "muscle", "start"]),
    _v("vehicles", "cars", "V8 idle, lumpy cam", engine_idle, {}, ["car", "v8", "idle", "muscle"]),
    _v("vehicles", "cars", "Four cylinder idle", engine_idle, {"cyl": 4, "idle": 850, "lope": 0.1}, ["car", "idle"]),
    _v("vehicles", "cars", "V8 revs", engine_rev, {"revs": 2}, ["car", "v8", "rev"]),
    _v("vehicles", "cars", "V8 three revs, crackle", engine_rev, {"revs": 3, "peak_rpm": 7000}, ["car", "rev", "pops"]),
    _v("vehicles", "cars", "Car passing by", car_passby, {}, ["car", "pass-by", "street"]),
    _v("vehicles", "cars", "Car passing fast", car_passby, {"speed": 38, "sec": 5.0}, ["car", "pass-by", "fast"]),
    _v("vehicles", "cars", "Tire screech", tire_screech, {}, ["tires", "skid", "drift", "screech"]),
    _v("vehicles", "cars", "Long drift screech", tire_screech, {"sec": 4.5, "pitch": 1150}, ["drift", "tires"]),
    _v("vehicles", "cars", "Car door close", car_door, {"kind": "close"}, ["car", "door"]),
    _v("vehicles", "cars", "Car door open", car_door, {"kind": "open"}, ["car", "door"]),
    # Supercars
    _v("vehicles", "supercars", "V10 supercar revs", engine_rev, {"cyl": 10, "idle": 1000, "peak_rpm": 8500, "revs": 2, "bright": 1.4}, ["lambo", "supercar", "v10", "rev", "flex"]),
    _v("vehicles", "supercars", "V12 supercar revs", engine_rev, {"cyl": 12, "idle": 1000, "peak_rpm": 8800, "revs": 3, "bright": 1.5}, ["lambo", "v12", "rev", "flex"]),
    _v("vehicles", "supercars", "V10 supercar flyby", supercar_flyby, {}, ["lambo", "flyby", "fast"]),
    _v("vehicles", "supercars", "V12 flyby with gear shift", supercar_flyby, {"cyl": 12, "rpm_hi": 8800}, ["lambo", "flyby", "shift"]),
    _v("vehicles", "supercars", "Supercar start and rev", car_start, {"cyl": 10, "idle": 1100, "rev_after": True}, ["lambo", "start", "rev"]),
    _v("vehicles", "supercars", "Flat six rev", engine_rev, {"cyl": 6, "idle": 900, "peak_rpm": 8800, "revs": 2, "bright": 1.6}, ["sports car", "rev"]),
    _v("vehicles", "supercars", "Supercar launch", lambda rng: supercar_flyby(rng, 10, 5.0, 8400, True), {}, ["launch", "fast"]),
    # Horns
    _v("vehicles", "horns", "Car horn", car_horn, {}, ["horn", "honk"]),
    _v("vehicles", "horns", "Car horn, double tap", car_horn, {"beeps": 2}, ["horn", "honk"]),
    _v("vehicles", "horns", "Car horn, long lean", car_horn, {"sec": 2.2}, ["horn", "road rage"]),
    _v("vehicles", "horns", "Small car horn", car_horn, {"kind": "small", "beeps": 2}, ["horn", "beep beep"]),
    _v("vehicles", "horns", "Truck horn", car_horn, {"kind": "truck", "sec": 1.4}, ["horn", "truck"]),
    _v("vehicles", "horns", "Semi truck air horn", air_horn_truck, {"sec": 2.5}, ["air horn", "semi", "truck"]),
    _v("vehicles", "horns", "Bike bell", lambda rng: bell_ringer(rng, 0.9, 3400, 12, (1, 2.1, 3.3), 0.4), {}, ["bike", "bell"]),
    # Trains
    _v("vehicles", "trains", "Freight train passing", train_pass, {}, ["train", "freight", "pass-by"]),
    _v("vehicles", "trains", "Train passing with horn", train_pass, {"horn": True}, ["train", "horn"]),
    _v("vehicles", "trains", "Fast train passing", train_pass, {"speed": 45, "sec": 10.0}, ["train", "fast"]),
    _v("vehicles", "trains", "Diesel train horn", train_horn, {}, ["train", "horn", "five chime"]),
    _v("vehicles", "trains", "Train horn, far away", train_horn, {"distance": 1.0, "sec": 3.0}, ["train", "horn", "distant"]),
    _v("vehicles", "trains", "Train horn, two blasts", lambda rng: np.concatenate([to_mono(train_horn(rng, 1.0, distance=0.2)), to_mono(train_horn(rng, 2.0, distance=0.2))]), {}, ["train", "horn"]),
    _v("vehicles", "trains", "Steam whistle", steam_whistle, {}, ["train", "steam", "whistle"]),
    _v("vehicles", "trains", "Subway brakes", subway_brakes, {}, ["subway", "brakes", "squeal", "city"]),
    # Aircraft
    _v("vehicles", "aircraft", "Jet flyover", jet_flyover, {}, ["jet", "plane", "flyover"]),
    _v("vehicles", "aircraft", "Helicopter passing", helicopter, {}, ["helicopter", "chopper"]),
    _v("vehicles", "aircraft", "Helicopter hovering", helicopter, {"pass_by": False}, ["helicopter", "hover"]),
    # Motorcycles
    _v("vehicles", "motorcycles", "Motorcycle revs", motorcycle_rev, {}, ["motorcycle", "rev", "bike"]),
    _v("vehicles", "motorcycles", "Sport bike revs", engine_rev, {"cyl": 4, "idle": 1300, "peak_rpm": 12000, "revs": 2, "bright": 1.7}, ["sport bike", "rev"]),
    _v("vehicles", "motorcycles", "Dirt bike passing", dirtbike_pass, {}, ["dirt bike", "pass-by"]),
    # Boats
    _v("vehicles", "boats", "Ship horn", boat_horn, {}, ["ship", "horn", "foghorn"]),
    _v("vehicles", "boats", "Foghorn, deep", boat_horn, {"f0": 55, "sec": 4.5}, ["foghorn", "deep", "dark"]),
    _v("vehicles", "boats", "Boat horn, short", boat_horn, {"f0": 110, "sec": 1.5}, ["boat", "horn"]),

    # Human / Gibberish
    _v("human", "gibberish", "Gibberish talking, guy", gibberish, {"sec": 4.0}, ["gibberish", "talking", "skit"]),
    _v("human", "gibberish", "Gibberish talking, woman", gibberish, {"sec": 4.0, "pitch": 210, "gender": "f"}, ["gibberish", "talking"]),
    _v("human", "gibberish", "Gibberish, excited guy", gibberish, {"sec": 4.0, "pitch": 140, "rate": 6, "excited": True}, ["gibberish", "excited"]),
    _v("human", "gibberish", "Gibberish, deep voice", gibberish, {"sec": 4.0, "pitch": 85, "rate": 3.5}, ["gibberish", "deep"]),
    _v("human", "gibberish", "Gibberish, chipmunk", gibberish_pitched, {"shift": 2.2}, ["gibberish", "chipmunk", "high", "funny"]),
    _v("human", "gibberish", "Gibberish, demon slowed", gibberish_pitched, {"shift": 0.55}, ["gibberish", "demon", "slowed", "dark"]),
    _v("human", "gibberish", "Gibberish, kid", gibberish, {"sec": 3.0, "pitch": 290, "gender": "f", "rate": 5}, ["gibberish", "kid"]),
    _v("human", "gibberish", "Robot talking", robot_voice, {}, ["robot", "voice", "sci-fi"]),
    _v("human", "gibberish", "Robot talking, low", robot_voice, {"pitch": 65}, ["robot", "deep"]),
    # Yells
    _v("human", "yells", "Guy yelling (gibberish)", gibberish, {"sec": 2.5, "pitch": 150, "rate": 5, "excited": True, "shout": True}, ["yell", "shout", "angry"]),
    _v("human", "yells", "Woman yelling (gibberish)", gibberish, {"sec": 2.5, "pitch": 240, "gender": "f", "rate": 5, "excited": True, "shout": True}, ["yell", "shout"]),
    _v("human", "yells", "Short shout, guy", gibberish, {"sec": 0.7, "pitch": 170, "rate": 3, "shout": True}, ["shout", "hey"]),
    # Crowd
    _v("human", "crowd", "Crowd murmur, room", crowd_murmur, {}, ["crowd", "walla", "party", "room"]),
    _v("human", "crowd", "Busy crowd, excited", crowd_murmur, {"voices": 22, "excited": True}, ["crowd", "party", "club"]),
    _v("human", "crowd", "Small group talking", crowd_murmur, {"voices": 5, "sec": 6.0}, ["crowd", "small group"]),
    # Body
    _v("human", "body", "Heartbeat", heartbeat, {}, ["heartbeat", "pulse", "dark"]),
    _v("human", "body", "Heartbeat, racing", heartbeat, {"bpm": 135, "tense": True}, ["heartbeat", "tense"]),
    _v("human", "body", "Breathing", breath, {"sec": 6.0}, ["breath", "breathing"]),
    _v("human", "body", "Heavy breathing", breath, {"sec": 5.0, "heavy": True}, ["breath", "panting"]),

    # Impacts
    _v("impacts", "booms", "808 boom", boom, {"sec": 2.5, "f_hi": 150, "f_lo": 40, "dirt": 0.1, "verb": 0.15}, ["boom", "808", "trap"]),
    _v("impacts", "booms", "Cinematic boom", boom, {"sec": 4.0}, ["boom", "trailer", "cinematic"]),
    _v("impacts", "booms", "Deep boom, long tail", boom, {"sec": 6.0, "f_lo": 28, "verb": 0.6}, ["boom", "deep"]),
    _v("impacts", "booms", "Dirty boom", boom, {"sec": 3.0, "dirt": 0.9}, ["boom", "dirty"]),
    _v("impacts", "hits", "Cinematic metal hit", cinematic_hit, {}, ["hit", "metal", "trailer"]),
    _v("impacts", "hits", "Cinematic hit, clean", cinematic_hit, {"metal": False}, ["hit"]),
    _v("impacts", "hits", "Punch, heavy", punch, {}, ["punch", "fight"]),
    _v("impacts", "hits", "Punch, light", punch, {"heavy": False}, ["punch", "slap"]),
    _v("impacts", "braams", "Braam, dark", braam, {}, ["braam", "trailer", "dark"]),
    _v("impacts", "braams", "Braam, bright", braam, {"root": 73.42, "dark": False}, ["braam", "trailer"]),
    _v("impacts", "braams", "Braam, low", braam, {"root": 41.2, "sec": 5.0}, ["braam", "deep"]),
    _v("impacts", "sub-drops", "Sub drop", sub_drop, {}, ["sub drop", "808", "drop"]),
    _v("impacts", "sub-drops", "Sub drop, long", sub_drop, {"sec": 4.0, "f_hi": 90, "f_lo": 25}, ["sub drop", "long"]),
    _v("impacts", "sub-drops", "Sub drop, short", sub_drop, {"sec": 1.2, "f_hi": 150, "f_lo": 40}, ["sub drop", "short"]),

    # Transitions
    _v("transitions", "risers", "Noise riser, 4 seconds", riser, {}, ["riser", "build up", "edm"]),
    _v("transitions", "risers", "Noise riser, 8 seconds", riser, {"sec": 8.0}, ["riser", "build up", "long"]),
    _v("transitions", "risers", "Synth riser", riser, {"kind": "tone"}, ["riser", "synth"]),
    _v("transitions", "risers", "Endless rise", riser, {"kind": "shepard", "sec": 6.0}, ["riser", "tension"]),
    _v("transitions", "downlifters", "Downlifter", downlifter, {}, ["downlifter", "fall"]),
    _v("transitions", "downlifters", "Downlifter, long", downlifter, {"sec": 5.0}, ["downlifter"]),
    _v("transitions", "whooshes", "Whoosh, fast", whoosh, {"sec": 0.6}, ["whoosh", "swish"]),
    _v("transitions", "whooshes", "Whoosh, medium", whoosh, {}, ["whoosh"]),
    _v("transitions", "whooshes", "Whoosh, slow and dark", whoosh, {"sec": 2.2, "bright": 0.5}, ["whoosh", "dark"]),
    _v("transitions", "reverse", "Reverse cymbal", reverse_cymbal, {}, ["reverse", "cymbal", "swell"]),
    _v("transitions", "reverse", "Reverse cymbal, short", reverse_cymbal, {"sec": 1.5}, ["reverse", "cymbal"]),
    _v("transitions", "tape-stops", "Tape stop", tape_stop, {}, ["tape stop", "slow down", "transition"]),
    _v("transitions", "tape-stops", "Tape stop, slow", tape_stop, {"sec": 2.8, "f0": 82.4}, ["tape stop"]),
    _v("transitions", "tape-stops", "Record scratch", vinyl_scratch, {}, ["scratch", "dj", "vinyl"]),
    _v("transitions", "tape-stops", "Record scratch, quick", vinyl_scratch, {"sec": 0.6, "rate": 6}, ["scratch", "dj"]),
    _v("transitions", "glitches", "Glitch stutter", glitch, {}, ["glitch", "stutter"]),
    _v("transitions", "glitches", "Glitch, long", glitch, {"sec": 3.0}, ["glitch"]),

    # Weapons
    _v("weapons", "gunshots", "Pistol shot", gunshot, {"kind": "pistol"}, ["gunshot", "pistol", "drill", "gun"]),
    _v("weapons", "gunshots", "Pistol shot, distant", gunshot, {"kind": "pistol", "distance": 0.8}, ["gunshot", "distant"]),
    _v("weapons", "gunshots", "Rifle shot", gunshot, {"kind": "rifle"}, ["gunshot", "rifle"]),
    _v("weapons", "gunshots", "Shotgun blast", gunshot, {"kind": "shotgun"}, ["gunshot", "shotgun"]),
    _v("weapons", "gunshots", "Silenced shot", gunshot, {"kind": "silenced"}, ["silencer", "gun"]),
    _v("weapons", "gunshots", "Three shots", lambda rng: np.concatenate([to_mono(gunshot(rng, "pistol"))[: n_of(0.32)] for _ in range(2)] + [to_mono(gunshot(rng, "pistol"))]), {}, ["gunshot", "burst"]),
    _v("weapons", "reloads", "Shotgun pump", gun_cock, {"kind": "pump"}, ["gun cock", "pump", "reload"]),
    _v("weapons", "reloads", "Pistol slide", gun_cock, {"kind": "slide"}, ["gun cock", "slide"]),
    _v("weapons", "reloads", "Magazine in", gun_cock, {"kind": "mag"}, ["reload", "magazine"]),
    _v("weapons", "explosions", "Explosion", explosion, {}, ["explosion", "bomb"]),
    _v("weapons", "explosions", "Big explosion", explosion, {"sec": 7.0, "size": 1.6}, ["explosion", "big"]),
    _v("weapons", "explosions", "Firework", firework, {}, ["firework", "celebration"]),

    # Money
    _v("money", "register", "Cash register ka-ching", cash_register, {}, ["cash register", "money", "ka-ching", "flex"]),
    _v("money", "coins", "Coin drop", coin_drop, {}, ["coin", "money"]),
    _v("money", "coins", "Coins spilling", coin_drop, {"count": 8}, ["coins", "money"]),
    _v("money", "coins", "Bag of coins", money_bag, {}, ["coins", "bag"]),
    _v("money", "counting", "Money counter, fast", money_count, {}, ["money counter", "bills", "cash", "flex"]),
    _v("money", "counting", "Money counter, slow", money_count, {"fast": False, "sec": 3.0}, ["money counter", "bills"]),
    _v("money", "counting", "Bills riffle", money_count, {"sec": 0.8}, ["bills", "riffle"]),

    # Ambience
    _v("ambience", "weather", "Light rain", rain, {"heavy": 0.2}, ["rain", "chill", "lofi"]),
    _v("ambience", "weather", "Heavy rain", rain, {"heavy": 0.9}, ["rain", "storm"]),
    _v("ambience", "weather", "Rain on a roof", rain, {"heavy": 0.5, "roof": True}, ["rain", "roof"]),
    _v("ambience", "weather", "Thunder clap, close", thunder, {}, ["thunder", "storm"]),
    _v("ambience", "weather", "Thunder, distant rumble", thunder, {"close": False}, ["thunder", "distant"]),
    _v("ambience", "weather", "Wind howling", wind, {}, ["wind", "howl", "dark"]),
    _v("ambience", "weather", "Wind, soft", wind, {"howl": False}, ["wind"]),
    _v("ambience", "nature", "Campfire", fire_crackle, {}, ["fire", "crackle", "campfire"]),
    _v("ambience", "nature", "Ocean waves", ocean, {}, ["ocean", "waves", "beach"]),
    _v("ambience", "nature", "Stream", stream, {}, ["water", "stream"]),
    _v("ambience", "nature", "Crickets at night", crickets, {}, ["crickets", "night"]),
    _v("ambience", "city", "City at night with siren", city_night, {}, ["city", "night", "street"]),
    _v("ambience", "city", "Vinyl crackle", vinyl_crackle, {}, ["vinyl", "crackle", "lofi"]),

    # Sci-fi and game
    _v("scifi", "lasers", "Laser zap", laser, {}, ["laser", "zap"]),
    _v("scifi", "lasers", "Laser, high", laser, {"f_hi": 4000, "f_lo": 900, "sec": 0.25}, ["laser"]),
    _v("scifi", "lasers", "Laser, wobble", laser, {"kind": "wobble", "sec": 0.6}, ["laser", "wobble"]),
    _v("scifi", "game", "Power up", power_up, {}, ["power up", "8-bit", "game"]),
    _v("scifi", "game", "Coin pickup", coin_pickup, {}, ["coin", "8-bit", "game"]),
    _v("scifi", "game", "Jump", jump, {}, ["jump", "8-bit"]),
    _v("scifi", "game", "Game over", game_over, {}, ["game over", "8-bit", "fail"]),
    _v("scifi", "game", "Power up, smooth", power_up, {"chip": False}, ["power up"]),
    _v("scifi", "space", "Teleport", teleport, {}, ["teleport", "sci-fi"]),
    _v("scifi", "space", "UFO hovering", ufo, {}, ["ufo", "alien"]),
    _v("scifi", "space", "Computer beeps", computer_beeps, {}, ["computer", "beeps", "data"]),

    # Foley
    _v("foley", "doors", "Door knock", door_knock, {}, ["knock", "door"]),
    _v("foley", "doors", "Heavy door knock", door_knock, {"knocks": 4, "heavy": True}, ["knock", "police", "door"]),
    _v("foley", "doors", "Door slam", door_slam, {}, ["door", "slam"]),
    _v("foley", "doors", "Door creak", door_creak, {}, ["creak", "door", "horror"]),
    _v("foley", "household", "Glass break", glass_break, {}, ["glass", "break", "smash"]),
    _v("foley", "household", "Window smash", glass_break, {"big": True}, ["glass", "window", "smash"]),
    _v("foley", "household", "Clock ticking", clock_tick, {}, ["clock", "tick", "time"]),
    _v("foley", "household", "Fast ticking", clock_tick, {"rate": 4.0, "sec": 4.0}, ["clock", "tick", "tension"]),
    _v("foley", "household", "Typewriter", typewriter, {}, ["typewriter", "typing"]),
    _v("foley", "household", "Lighter flick", lighter, {}, ["lighter", "flick", "smoke"]),
    _v("foley", "household", "Soda can open", can_open, {}, ["can", "soda", "fizz"]),
    _v("foley", "household", "Zipper", zipper, {}, ["zipper"]),
    _v("foley", "footsteps", "Footsteps, concrete", footsteps, {}, ["footsteps", "walking"]),
    _v("foley", "footsteps", "Footsteps, wood floor", footsteps, {"surface": "wood"}, ["footsteps", "wood"]),
    _v("foley", "footsteps", "Footsteps, gravel", footsteps, {"surface": "gravel"}, ["footsteps", "gravel"]),
    _v("foley", "footsteps", "Running footsteps", footsteps, {"rate": 3.4}, ["footsteps", "running"]),
]
