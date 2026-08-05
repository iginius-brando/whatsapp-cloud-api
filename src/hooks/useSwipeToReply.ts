"use client";

import { useCallback, useRef, type PointerEvent, type MouseEvent } from "react";

/**
 * Gesto "trascina per rispondere", come nell'app WhatsApp: si spinge la bolla
 * verso destra e al rilascio parte la risposta.
 *
 * Vale solo per dito e pennino. Col mouse trascinare significa selezionare il
 * testo, quindi su desktop resta il bottone che compare al passaggio del mouse.
 */

/** Spostamento del dito oltre il quale il rilascio vale come risposta. */
const TRIGGER_PX = 64;
/** Quanto può spostarsi la bolla: oltre, il gesto continua ma lei sta ferma. */
const MAX_OFFSET_PX = 72;
/** Frazione del movimento che la bolla segue davvero (effetto elastico). */
const DAMPING = 0.55;
/** Spostamento minimo prima di decidere se il gesto è nostro o è uno scroll. */
const DIRECTION_PX = 10;
/** Finestra in cui sopprimere il click generato dalla fine dello swipe. */
const CLICK_GUARD_MS = 300;

/**
 * Elementi che usano già il trascinamento orizzontale per conto loro: la barra
 * di avanzamento di un audio o di un video va lasciata in pace.
 */
const NO_SWIPE_SELECTOR = "audio, video, input, textarea";

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  /** True da quando abbiamo stabilito che il gesto è orizzontale. */
  active: boolean;
  /** Spostamento grezzo del dito. */
  distance: number;
}

export function useSwipeToReply(onReply?: () => void) {
  // Durante il trascinamento scriviamo direttamente sul DOM: un setState per
  // ogni pointermove rirenderizzerebbe la bolla (e il suo allegato) 60 volte
  // al secondo per una semplice traslazione.
  const contentRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const swipedAt = useRef(0);

  const paint = useCallback((offset: number, animate: boolean) => {
    const content = contentRef.current;
    if (content) {
      content.style.transition = animate ? "transform 160ms ease-out" : "";
      content.style.transform = offset ? `translateX(${offset}px)` : "";
    }

    const indicator = indicatorRef.current;
    if (indicator) {
      indicator.style.transition = animate ? "opacity 160ms ease-out" : "";
      indicator.style.opacity = String(Math.min(1, offset / (MAX_OFFSET_PX * 0.7)));
    }
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!onReply || event.pointerType === "mouse") return;
      if ((event.target as Element | null)?.closest(NO_SWIPE_SELECTOR)) return;

      gesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        distance: 0,
      };
    },
    [onReply],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;

      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;

      if (!current.active) {
        // Movimento prevalentemente verticale: è uno scroll, lasciamo perdere.
        if (Math.abs(dy) > Math.abs(dx)) {
          gesture.current = null;
          return;
        }
        // Verso sinistra o spostamento ancora minimo: aspettiamo.
        if (dx < DIRECTION_PX) return;

        current.active = true;
        event.currentTarget.setPointerCapture(current.pointerId);
      }

      current.distance = dx;
      paint(Math.min(MAX_OFFSET_PX, Math.max(0, dx * DAMPING)), false);
    },
    [paint],
  );

  const onPointerUp = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (!current?.active) return;

    paint(0, true);
    swipedAt.current = Date.now();

    if (current.distance >= TRIGGER_PX) {
      navigator.vibrate?.(10);
      onReply?.();
    }
  }, [onReply, paint]);

  const onPointerCancel = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.active) paint(0, true);
  }, [paint]);

  /**
   * Uno swipe che finisce su un'immagine o su un bottone genera comunque un
   * click: qui lo intercettiamo prima che arrivi a destinazione.
   */
  const onClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (Date.now() - swipedAt.current > CLICK_GUARD_MS) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    /** Va sull'elemento che si sposta: la bolla e il suo indicatore. */
    contentRef,
    /** Va sull'icona che affiora durante il trascinamento. */
    indicatorRef,
    /** Vanno sulla riga che riceve il gesto. */
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  };
}
