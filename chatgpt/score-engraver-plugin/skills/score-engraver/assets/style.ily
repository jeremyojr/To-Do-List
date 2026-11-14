%% score-engraver house style. \include once; do not restyle in the score file.
%%   ChordSymbols context   literal chord-symbol text on one baseline above the staff
%%   Note_label_engraver    small bold pitch names left of the noteheads (automatic)
%%   Page                   A4, 15 mm margins, no tagline
\version "2.24.0"

noteLabels = ##t        % ##f (set before \score) omits pitch labels
noteLabelTied = ##t     % ##f leaves tied-to (held) noteheads unlabelled
noteLabelSize = -7.5    % font-size of pitch labels; they must fit inside a staff space

#(define se-check (getenv "SCORE_ENGRAVER_CHECK"))   % colour-coded render for engrave.py

%% ---------- chord symbols ----------------------------------------------------
#(define (se-accidental glyph raise)
   (make-concat-markup
    (list (make-hspace-markup 0.1)
          (make-raise-markup raise
            (make-fontsize-markup -2.5 (make-musicglyph-markup glyph)))
          (make-hspace-markup 0.1))))

%% "Bbmaj7#11/Ab" -> text with real flat and sharp glyphs. `b` is a flat only after
%% a root or bass letter, or before a digit (b5, b9, b13).
#(define (se-chord-markup str)
   (let* ((n (string-length str))
          (ref (lambda (i) (if (and (>= i 0) (< i n)) (string-ref str i) #\space)))
          (flat? (lambda (i)
                   (and (char=? (ref i) #\b)
                        (or (char-numeric? (ref (1+ i)))
                            (and (memv (ref (1- i)) (string->list "ABCDEFG"))
                                 (or (= i 1) (char=? (ref (- i 2)) #\/))))))))
     (let loop ((i 0) (run '()) (out '()))
       (define (flush)
         (if (null? run) out (cons (list->string (reverse run)) out)))
       (cond
        ((= i n) (make-concat-markup (reverse (flush))))
        ((char=? (ref i) #\#)
         (loop (1+ i) '() (cons (se-accidental "accidentals.sharp" 0.55) (flush))))
        ((flat? i)
         (loop (1+ i) '() (cons (se-accidental "accidentals.flat" 0.3) (flush))))
        (else (loop (1+ i) (cons (ref i) run) out))))))

#(define (se-chord-stencil grob)
   (let ((t (ly:grob-property grob 'text)))
     (grob-interpret-markup grob (if (string? t) (se-chord-markup t) t))))

%% ---------- pitch labels -----------------------------------------------------
#(define (se-pitch-name p)
   (string-append
    (string (string-ref "CDEFGAB" (ly:pitch-notename p)))
    (case (ly:pitch-alteration p)
      ((1/2) "#") ((-1/2) "b") ((1) "##") ((-1) "bb") (else ""))))

%% Labels never touch a staff line: each one sits in a space, centred between two
%% lines (or their ledger continuation). Slot s is the space above line s (line 0 =
%% middle line). A note in a space takes its own slot, a note on a line the slot
%% just above it; clashing labels are pooled into consecutive slots
%% (pool-adjacent-violators on integers).
#(define (se-slots positions)   ; staff-positions, ascending -> slots, ascending
   (let* ((want (map (lambda (p) (floor (/ p 2))) positions))
          (idx (iota (length want)))
          (zs (map - want idx))
          (mean (lambda (b) (/ (car b) (cdr b))))
          (blocks
           (fold (lambda (z acc)
                   (let merge ((b (cons z 1)) (acc acc))
                     (if (and (pair? acc) (> (mean (car acc)) (mean b)))
                         (merge (cons (+ (car b) (caar acc)) (+ (cdr b) (cdar acc)))
                                (cdr acc))
                         (cons b acc))))
                 '() zs))
          (fit (append-map (lambda (b) (make-list (cdr b) (round (mean b))))
                           (reverse blocks))))
     (map + fit idx)))

#(define (se-label-markup entries)   ; entries: ((y . "F#") ...)
   (make-overlay-markup
    (map (lambda (e)
           (make-translate-markup
            (cons 0 (car e))
            (make-vcenter-markup (make-right-align-markup (cdr e)))))
         entries)))

%% A tie arriving at a labelled chord stops short of the label column instead of
%% running through it.
#(define (se-tie-stencil label)
   (lambda (tie)
     (let ((cps (ly:grob-property tie 'control-points))
           (sys (ly:grob-system tie)))
       (if (and (pair? cps) (ly:grob? sys) (grob::is-live? label)
                (eq? sys (ly:grob-system label)))
           (let* ((x0 (car (first cps)))
                  (x3 (car (last cps)))
                  (lim (- (car (ly:grob-extent label sys X))
                          (ly:grob-relative-coordinate tie sys X)
                          0.25)))
             (if (and (> x3 lim) (> (- lim x0) 1.0))
                 (ly:grob-set-property! tie 'control-points
                   (map (lambda (p)
                          (cons (+ x0 (* (- (car p) x0) (/ (- lim x0) (- x3 x0))))
                                (cdr p)))
                        cps)))))
       (ly:tie::print tie))))

#(set-object-property! 'noteLabelNudge 'translation-type? number?)

#(define (Note_label_engraver context)
   (let ((heads '()) (supports '()) (ties '()) (label #f))
     (make-engraver
      (acknowledgers
       ((note-head-interface engraver grob source)
        (set! heads (cons grob heads)))
       ((accidental-interface engraver grob source)
        (set! supports (cons grob supports)))
       ((arpeggio-interface engraver grob source)
        (set! supports (cons grob supports)))
       ((tie-interface engraver grob source)
        (set! ties (cons grob ties))))
      (end-acknowledgers   ; 2.24 announces a tie's end at the tied-to note
       ((tie-interface engraver grob source)
        (set! ties (cons grob ties))))
      ((process-acknowledged engraver)
       (if (and noteLabels (pair? heads) (not label))
           (set! label (ly:engraver-make-grob engraver 'TextScript (car heads)))))
      ((stop-translation-timestep engraver)
       (if label
           (let* ((pos (lambda (h) (ly:grob-property h 'staff-position 0)))
                  (arriving (filter (lambda (t) (memq (ly:spanner-bound t RIGHT) heads))
                                    ties))
                  (tied (map (lambda (t) (ly:spanner-bound t RIGHT)) arriving))
                  (space (ly:staff-symbol-staff-space (car heads)))
                  (entries      ; ((staff-position . "F#") ...), ascending, unique
                   (delete-duplicates
                    (sort (map (lambda (h)
                                 (cons (pos h)
                                       (se-pitch-name
                                        (ly:event-property (event-cause h) 'pitch))))
                               (if noteLabelTied heads
                                   (filter (lambda (h) (not (memq h tied))) heads)))
                          (lambda (a b) (< (car a) (car b))))))
                  (ys (map (lambda (s) (* space (+ s 1/2)))
                           (se-slots (map car entries))))
                  ;; ledger lines stick out left of the head: stand further off
                  (pad (if (any (lambda (h) (> (abs (pos h)) 5)) heads) 0.8 0.4))
                  (width (* (magstep (+ noteLabelSize 7.5))
                            (+ 0.3 (* 0.65 (apply max 0 (map (lambda (e)
                                                               (string-length (cdr e)))
                                                             entries)))))))
             (if (null? entries)
                 (ly:grob-suicide! label)
                 (begin
                   (for-each
                    (lambda (g)
                      (ly:pointer-group-interface::add-grob label 'side-support-elements g))
                    (append heads supports))
                   (ly:grob-set-property! label 'text
                     (se-label-markup (map (lambda (y e) (cons y (cdr e))) ys entries)))
                   (for-each
                    (lambda (kv) (ly:grob-set-property! label (car kv) (cdr kv)))
                    `((font-family . sans) (font-series . bold) (font-size . ,noteLabelSize)
                      (side-axis . ,X) (direction . ,LEFT) (padding . ,pad)
                      (X-offset . ,ly:side-position-interface::x-aligned-side)
                      (Y-offset . ,(ly:context-property context 'noteLabelNudge 0))
                      (outside-staff-priority . #f)
                      (extra-spacing-width . (-0.3 . 0)) (avoid-slur . inside)
                      (color . ,(if se-check red black))))
                   (for-each
                    (lambda (t)
                      (ly:grob-set-property! t 'stencil (se-tie-stencil label))
                      (ly:grob-set-property! t 'springs-and-rods
                                             ly:spanner::set-spacing-rods)
                      ;; room for a visible tie before the labels; after a line
                      ;; break the rod is measured from the system start, so add
                      ;; the clef and key signature
                      (let ((room (+ 2.5 width pad (if (null? supports) 0 1.4)))
                            (key (length (ly:context-property context 'keyAlterations '()))))
                        (ly:grob-set-property! t 'minimum-length (+ room 1.3))
                        (ly:grob-set-property! t 'minimum-length-after-break
                          (+ room 3.6 (if (zero? key) 0 (+ 0.6 (* 1.1 key)))))))
                    arriving)))))
       (set! heads '()) (set! supports '()) (set! ties '()) (set! label #f)))))

%% \labelNudge #0.6 before a note shifts that moment's labels up (negative: down).
labelNudge =
#(define-music-function (dy) (number?)
   #{ \once \set Staff.noteLabelNudge = #dy #})

%% ---------- contexts & page --------------------------------------------------
\layout {
  \context {
    \Lyrics
    \name ChordSymbols
    \alias Lyrics
    \override VerticalAxisGroup.staff-affinity = #DOWN
    \override VerticalAxisGroup.nonstaff-relatedstaff-spacing = #'((padding . 0.9))
    \override LyricText.stencil = #se-chord-stencil
    \override LyricText.self-alignment-X = #LEFT
    \override LyricText.font-size = #1.5
    \override LyricText.color = #(if se-check red black)
    \override LyricSpace.minimum-distance = #1.6
  }
  \context { \Score \accepts ChordSymbols }
  \context { \Staff \consists #Note_label_engraver }
}

#(if se-check
     (ly:parser-include-string
      "\\layout { \\context { \\Score \\override StaffSymbol.color = #blue } }"))

\paper {
  #(set-paper-size "a4")
  top-margin = 15\mm
  bottom-margin = 15\mm
  left-margin = 15\mm
  right-margin = 15\mm
  indent = 0
}

\header { tagline = ##f }
