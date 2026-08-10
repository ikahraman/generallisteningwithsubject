import { countWords, pickBestVoice } from '../utils/helpers.js'

// Unified player over two backends:
//  - "audio": a cached TTS-generated WAV blob (HTMLAudioElement), with
//    sentence timing estimated proportionally by word count (none of the
//    TTS backends return per-word timestamps, so exact sync isn't available).
//  - "browser": the Web Speech API, spoken sentence-by-sentence so sentence
//    boundaries are exact (onstart/onend), at the cost of a coarser,
//    sentence-granularity progress bar instead of continuous time.
export class MaterialPlayer extends EventTarget {
  constructor({ sentences, audioBlob, voiceURI, rate = 1 }) {
    super()
    this.sentences = sentences
    this.rate = rate
    this.currentIndex = -1
    this.mode = audioBlob ? 'audio' : 'browser'
    this.audioBlobRef = audioBlob || null

    if (this.mode === 'audio') this._initAudio(audioBlob)
    else this._initBrowser(voiceURI)
  }

  _initAudio(blob) {
    this.audioURL = URL.createObjectURL(blob)
    this.audio = new Audio(this.audioURL)
    this.audio.playbackRate = this.rate

    this.audio.addEventListener('loadedmetadata', () => {
      this.timings = computeSentenceTimings(this.sentences, this.audio.duration)
      this.dispatchEvent(new CustomEvent('ready', { detail: { duration: this.audio.duration } }))
    })
    this.audio.addEventListener('timeupdate', () => {
      this.dispatchEvent(
        new CustomEvent('timeupdate', {
          detail: { currentTime: this.audio.currentTime, duration: this.audio.duration || 0 },
        })
      )
      const idx = this._findSentenceIndex(this.audio.currentTime)
      if (idx !== this.currentIndex) {
        this.currentIndex = idx
        this.dispatchEvent(new CustomEvent('sentencechange', { detail: { index: idx } }))
      }
    })
    this.audio.addEventListener('ended', () => this.dispatchEvent(new CustomEvent('ended')))
    this.audio.addEventListener('play', () =>
      this.dispatchEvent(new CustomEvent('playstate', { detail: { playing: true } }))
    )
    this.audio.addEventListener('pause', () =>
      this.dispatchEvent(new CustomEvent('playstate', { detail: { playing: false } }))
    )
  }

  _findSentenceIndex(time) {
    if (!this.timings) return -1
    return this.timings.findIndex((t) => time >= t.start && time < t.end)
  }

  _initBrowser(voiceURI) {
    this.voiceURI = voiceURI
    this.queueIndex = -1
    this._stopRequested = false
  }

  _pickVoice() {
    const voices = speechSynthesis.getVoices()
    return voices.find((v) => `${v.name}::${v.lang}` === this.voiceURI) || pickBestVoice(voices)
  }

  _speakFrom(index) {
    if (index >= this.sentences.length) {
      this.currentIndex = -1
      this.queueIndex = -1
      this.dispatchEvent(new CustomEvent('playstate', { detail: { playing: false } }))
      this.dispatchEvent(new CustomEvent('ended'))
      return
    }
    this.queueIndex = index
    const utter = new SpeechSynthesisUtterance(this.sentences[index].text)
    const voice = this._pickVoice()
    if (voice) utter.voice = voice
    utter.rate = this.rate

    utter.onstart = () => {
      this.currentIndex = index
      this.dispatchEvent(new CustomEvent('sentencechange', { detail: { index } }))
      this.dispatchEvent(new CustomEvent('playstate', { detail: { playing: true } }))
      this.dispatchEvent(
        new CustomEvent('timeupdate', { detail: { currentTime: index, duration: this.sentences.length } })
      )
    }
    utter.onend = () => {
      if (this._stopRequested) {
        this._stopRequested = false
        return
      }
      this._speakFrom(index + 1)
    }
    speechSynthesis.speak(utter)
  }

  play() {
    if (this.mode === 'audio') return this.audio.play()
    this._speakFrom(this.queueIndex < 0 ? 0 : this.queueIndex)
  }

  pause() {
    if (this.mode === 'audio') return this.audio.pause()
    this._stopRequested = true
    speechSynthesis.cancel()
    this.dispatchEvent(new CustomEvent('playstate', { detail: { playing: false } }))
  }

  togglePlay() {
    const playing = this.mode === 'audio' ? !this.audio.paused : this.queueIndex >= 0 && !this._stopRequested
    if (playing) this.pause()
    else this.play()
  }

  seekToSentence(index) {
    if (this.mode === 'audio') {
      const t = this.timings?.[index]
      if (t) this.audio.currentTime = t.start
    } else {
      speechSynthesis.cancel()
      this._speakFrom(index)
    }
  }

  repeatSentence() {
    if (this.currentIndex < 0) return
    this.seekToSentence(this.currentIndex)
    this.play()
  }

  repeatParagraph() {
    if (this.currentIndex < 0) return
    const paragraphIndex = this.sentences[this.currentIndex].paragraphIndex
    const firstIndex = this.sentences.findIndex((s) => s.paragraphIndex === paragraphIndex)
    this.seekToSentence(firstIndex)
    this.play()
  }

  setRate(rate) {
    this.rate = rate
    if (this.mode === 'audio') this.audio.playbackRate = rate
  }

  // Switches an in-progress 'browser'-mode player over to real cached audio
  // once it finishes downloading in the background — same instance (not a
  // new object), so listeners already wired via wireAudioPlayer keep
  // working without needing to be re-attached.
  upgradeToBlob(blob) {
    if (this.mode === 'audio') return
    speechSynthesis.cancel()
    this._stopRequested = true
    this.mode = 'audio'
    this.audioBlobRef = blob
    this._initAudio(blob)
    this.dispatchEvent(new CustomEvent('playstate', { detail: { playing: false } }))
  }

  destroy() {
    if (this.mode === 'audio') {
      this.audio.pause()
      URL.revokeObjectURL(this.audioURL)
    } else {
      speechSynthesis.cancel()
    }
  }
}

function computeSentenceTimings(sentences, totalDuration) {
  const totalWords = sentences.reduce((sum, s) => sum + countWords(s.text), 0) || 1
  let elapsed = 0
  return sentences.map((s) => {
    const words = countWords(s.text)
    const duration = totalDuration * (words / totalWords)
    const start = elapsed
    elapsed += duration
    return { start, end: elapsed }
  })
}

// Flattens material.paragraphs into a single sentence list with paragraph refs.
export function flattenSentences(paragraphs) {
  const flat = []
  paragraphs.forEach((p, paragraphIndex) => {
    ;(p.sentences?.length ? p.sentences : [p.text]).forEach((text) => {
      flat.push({ text, paragraphIndex, globalIndex: flat.length })
    })
  })
  return flat
}
