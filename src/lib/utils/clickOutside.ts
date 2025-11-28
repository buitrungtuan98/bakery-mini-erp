/**
 * Dispatch event on click outside of node
 */
export function clickOutside(node: HTMLElement, callback: () => void) {

    const handleClick = (event: MouseEvent) => {
      // Use standard bubbling phase check
      if (node && !node.contains(event.target as Node) && !event.defaultPrevented) {
        callback();
      }
    };

    // Use bubbling phase (false) instead of capture (true) to behave more standardly
    document.addEventListener('click', handleClick, false);

    return {
      destroy() {
        document.removeEventListener('click', handleClick, false);
      }
    };
  }
