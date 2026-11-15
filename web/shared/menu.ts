// The behavior of a floating menu opened from a button: ARIA wiring, keys, focus and closing.
// The caller owns the markup, the rows and what choosing a row does. DOM access stays inside
// functions so this module can be imported in node.

export type Menu = {
  open(): void;
  /** Closes; with `focusTrigger`, focus goes to the trigger. Does nothing when closed. */
  close(focusTrigger?: boolean): void;
  readonly isOpen: boolean;
};

export function attachMenu(o: {
  trigger: HTMLElement;
  /** The element with role="menu". It needs an id. Shown and hidden with its `hidden` attribute. */
  menu: HTMLElement;
  /** The rows the arrow keys visit, in order. Read each time. */
  items(): HTMLElement[];
  /** The row that takes focus on opening; the first of items() when absent or when it returns none. */
  first?(): HTMLElement | undefined;
  /** Runs right after the menu is shown and before focus moves into it, in the same task: fill the rows and measure here. */
  onOpen?(): void;
  onClose?(): void;
}): Menu {
  const { trigger, menu } = o;
  const isOpen = () => !menu.hidden;

  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", String(isOpen()));
  trigger.setAttribute("aria-controls", menu.id);

  const inside = (target: EventTarget | null) => target instanceof Node && (menu.contains(target) || trigger.contains(target));

  // Safari does not focus a pressed button, so a press can blur the focused row with no
  // relatedTarget; ignore focus changes while a pointer is down inside, or the menu would
  // close before the click lands.
  let pressing = false;
  const release = () => {
    pressing = false;
  };
  const press = (e: PointerEvent) => {
    if (isOpen() && inside(e.target)) pressing = true;
  };
  const onDocumentPointerDown = (e: PointerEvent) => {
    if (!menu.isConnected) return detach();
    if (isOpen() && !inside(e.target)) close();
  };
  // These exist only while the menu is open.
  function attach(): void {
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
  }
  function detach(): void {
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    document.removeEventListener("pointerup", release);
    document.removeEventListener("pointercancel", release);
    pressing = false;
  }

  function open(): void {
    if (isOpen()) return;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    attach();
    o.onOpen?.();
    const rows = o.items();
    (o.first?.() ?? rows[0])?.focus();
  }

  function close(focusTrigger = false): void {
    if (!isOpen()) return;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    detach();
    o.onClose?.();
    if (focusTrigger) trigger.focus();
  }

  trigger.addEventListener("click", () => (isOpen() ? close() : open()));
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open();
    }
  });
  menu.addEventListener("keydown", (e) => {
    const list = o.items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "ArrowDown":
        go(at + 1);
        break;
      case "ArrowUp":
        go(at - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(list.length - 1);
        break;
      case "Tab":
        close(true); // focus moves on from the trigger's neighbor naturally
        break;
    }
  });
  menu.addEventListener("pointerdown", press);
  trigger.addEventListener("pointerdown", press);
  menu.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus where it is during the press
  const onFocusOut = (e: FocusEvent) => {
    if (pressing || !isOpen()) return;
    if (!inside(e.relatedTarget)) close();
  };
  menu.addEventListener("focusout", onFocusOut);
  trigger.addEventListener("focusout", onFocusOut);

  return {
    open,
    close,
    get isOpen() {
      return isOpen();
    },
  };
}
