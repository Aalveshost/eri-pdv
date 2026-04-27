import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CreditCard, Banknote, QrCode, X, Pencil, Trash2, Smartphone, Clock } from "lucide-react";
import { useDatabase } from "../hooks/useDatabase";
import { useScanner } from "../hooks/useScanner";
import { processarVendaFIFO } from "../utils/fifoEngine";
import { normalizeText } from "../utils/text";
import { formatCurrency, parseCurrencyToNumber, handleCurrencyInput } from "../utils/currency";

// Module-level flag: set by Layout when user presses Enter on PDV sidebar link
// Checked on mount to decide whether to auto-focus the date input
export let pdvShouldFocusOnMount = false;
export function setPdvShouldFocusOnMount(val: boolean) { pdvShouldFocusOnMount = val; }

// Interceptor: Layout calls this before navigating away from PDV.
// If PDV has items in cart, it shows the exit confirm modal and returns true (blocked).
// Returns false if navigation can proceed freely.
export let pdvNavigateAwayInterceptor: (() => boolean) | null = null;

// True while any PDV modal/popup is open — Layout skips its key handling
export let pdvModalOpen = false;

interface CartItem {
  id: number;
  nome: string;
  preco: number;
  quantidade: number;
}

export default function PDV() {
  const { db } = useDatabase();
  const getTodayDigits = () => {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = String(now.getFullYear());
    return d + m + y;
  };

  const [stage, setStage] = useState<'date' | 'selling' | 'checkout'>('date');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [vendaDate, setVendaDate] = useState(formatDateBR(new Date()));
  const [dateDigits, setDateDigits] = useState(getTodayDigits().padEnd(8, '_'));
  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const [quantityInput, setQuantityInput] = useState("1.000");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingTotalInput, setEditingTotalInput] = useState("0,00");
  const [focusedZone, setFocusedZone] = useState<'products' | 'cart' | null>(null);
  const [focusedCartIndex, setFocusedCartIndex] = useState<number | null>(null);
  const [focusedCartAction, setFocusedCartAction] = useState<'edit' | 'delete' | null>(null);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
  const [focusedProductIndex, setFocusedProductIndex] = useState<number | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [exitConfirmSelected, setExitConfirmSelected] = useState<'exit' | 'continue'>('exit');
  // checkout keyboard nav: 'prazo'(row0) | 'dinheiro'(row1,col0) | 'pix'(row1,col1) | 'credito'(row2,col0) | 'debito'(row2,col1)
  type CheckoutOption = 'prazo' | 'dinheiro' | 'pix' | 'credito' | 'debito';
  const [checkoutSelected, setCheckoutSelected] = useState<CheckoutOption>('prazo');
  const [dateError, setDateError] = useState("");
  const [showClienteModal, setShowClienteModal] = useState(false);
  const [clientes, setClientes] = useState<{id:number;nome:string;telefone:string|null}[]>([]);
  const [clienteSearch, setClienteSearch] = useState('');
  const [clienteSelecionado, setClienteSelecionado] = useState<{id:number;nome:string}|null>(null);
  const [clienteFocusedIdx, setClienteFocusedIdx] = useState<number>(-1);
  const clienteListRef = useRef<HTMLDivElement>(null);
  const clienteItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [vendaSuccess, setVendaSuccess] = useState<string|null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const modalQuantityRef = useRef<HTMLInputElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const cartQuantityRef = useRef<HTMLInputElement>(null);
  const cartTotalRef = useRef<HTMLInputElement>(null);
  const cartFocusTrapRef = useRef<HTMLDivElement>(null);
  const productFocusTrapRef = useRef<HTMLDivElement>(null);
  const editingItemPrecoRef = useRef<number>(0);
  const editingItemIdRef = useRef<number | null>(null);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);
  const hasUserEnteredPDV = useRef(pdvShouldFocusOnMount);
  const focusedProductIndexRef = useRef<number | null>(null);

  function formatDateBR(date: Date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  }

  const total = cart.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);

  // Search for products (only when in selling stage)
  useEffect(() => {
    if (stage !== 'selling') return;

    const loadProducts = async () => {
      if (!db || search.length === 0) {
        setProducts([]);
        return;
      }

      try {
        const terms = search.split(/\s+/).filter(t => t.length > 0);
        const results: any[] = await db.select(
          "SELECT id, nome, preco_venda, codigo_barras FROM produtos WHERE ativo = 1 ORDER BY nome"
        );

        // First try exact barcode match
        const barcodeMatch = results.find(p => p.codigo_barras === search);
        if (barcodeMatch) {
          setSelectedProduct(barcodeMatch);
          setShowQuantityModal(true);
          setSearch("");
          return;
        }

        // Then try name search
        const filtered = results.filter(product => {
          const productNameNormalized = normalizeText(product.nome);
          return terms.every(term => productNameNormalized.includes(normalizeText(term)));
        });

        if (filtered.length > 0) {
          setProducts(filtered);
          setFocusedProductIndex(0);
          focusedProductIndexRef.current = 0;
        } else {
          setProducts([]);
          setFocusedProductIndex(null);
          focusedProductIndexRef.current = null;
        }
      } catch (err) {
        console.error("Erro ao buscar produtos:", err);
      }
    };

    const timer = setTimeout(loadProducts, 200);
    return () => clearTimeout(timer);
  }, [db, search, stage]);

  // Barcode integration
  useScanner((code) => {
    if (stage === 'selling') {
      setSearch(code);
    }
  });

  const handleProductSelect = (product: any) => {
    setSelectedProduct(product);
    setShowQuantityModal(true);
    setSearch("");
    setProducts([]);
  };

  const handleAddToCart = () => {
    const qty = parseFloat(quantityInput.replace(',', '.')) || 1;
    if (qty <= 0) return;

    setCart(prev => {
      const exists = prev.find(item => item.id === selectedProduct.id);
      if (exists) {
        return prev.map(item =>
          item.id === selectedProduct.id ? { ...item, quantidade: item.quantidade + (parseFloat(quantityInput.replace(',', '.')) || 1) } : item
        );
      }
      return [...prev, {
        id: selectedProduct.id,
        nome: selectedProduct.nome,
        preco: selectedProduct.preco_venda,
        quantidade: parseFloat(quantityInput.replace(',', '.')) || 1
      }];
    });

    setLastAddedId(selectedProduct.id);
    setTimeout(() => setLastAddedId(null), 600);

    setShowQuantityModal(false);
    setQuantityInput("1.000");
    setSelectedProduct(null);
    searchInputRef.current?.focus();
  };

  // On mount: focus if user entered via Enter; reset module flag
  useEffect(() => {
    if (pdvShouldFocusOnMount) {
      hasUserEnteredPDV.current = true;
      if (stage === 'date' && dateInputRef.current) {
        dateInputRef.current.focus();
        dateInputRef.current.setSelectionRange(0, 0);
      }
      setPdvShouldFocusOnMount(false);
    }
    return () => { setPdvShouldFocusOnMount(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus date input whenever stage is 'date'
  useEffect(() => {
    if (stage === 'date' && dateInputRef.current) {
      setTimeout(() => {
        dateInputRef.current?.focus();
        dateInputRef.current?.setSelectionRange(0, 0);
      }, 50);
    }
    if (stage === 'selling') {
      setFocusedZone(null);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [stage]);

  // Re-focus search input when exit confirm modal closes (ESC = continuar)
  useEffect(() => {
    if (!showExitConfirm && stage === 'selling') {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [showExitConfirm, stage]);

  // Cliente modal keyboard navigation
  useEffect(() => {
    if (!showClienteModal) return;
    setClienteFocusedIdx(-1);
  }, [showClienteModal, clienteSearch]);

  useEffect(() => {
    if (!showClienteModal) return;
    const filtered = clientes.filter(c =>
      c.nome.includes(clienteSearch) || (c.telefone || '').includes(clienteSearch)
    );
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        setClienteFocusedIdx(prev => {
          const next = Math.min(prev + 1, filtered.length - 1);
          const item = filtered[next];
          if (item) setClienteSelecionado({ id: item.id, nome: item.nome });
          setTimeout(() => clienteItemRefs.current[next]?.scrollIntoView({ block: 'nearest' }), 0);
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        setClienteFocusedIdx(prev => {
          const next = Math.max(prev - 1, 0);
          const item = filtered[next];
          if (item) setClienteSelecionado({ id: item.id, nome: item.nome });
          setTimeout(() => clienteItemRefs.current[next]?.scrollIntoView({ block: 'nearest' }), 0);
          return next;
        });
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        if (clienteSelecionado) handleFinalize('prazo', clienteSelecionado.id);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        setShowClienteModal(false);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showClienteModal, clienteSearch, clienteSelecionado, clientes]);

  // Checkout keyboard navigation + sidebar lock
  useEffect(() => {
    if (stage !== 'checkout') return;
    setCheckoutSelected('dinheiro');

    // nav map: key -> {up,down,left,right}
    const nav: Record<string, Partial<Record<string, string>>> = {
      dinheiro: { right: 'pix',      down: 'credito' },
      pix:      { left:  'dinheiro',  down: 'debito'  },
      credito:  { up: 'dinheiro',    right: 'debito', down: 'prazo' },
      debito:   { up: 'pix',         left:  'credito', down: 'prazo' },
      prazo:    { up: 'credito' },
    };

    const confirmSelected = (sel: string) => {
      if (sel === 'prazo') handleAPrazo();
      else handleFinalize(sel);
    };

    const handler = (e: KeyboardEvent) => {
      if (showClienteModal) return;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','Tab'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
      }
      if (e.key === 'Escape') { setStage('selling'); return; }
      if (e.key === 'Enter') {
        setCheckoutSelected(prev => { confirmSelected(prev); return prev; });
        return;
      }
      const moves: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Tab: 'down' };
      const dir = moves[e.key];
      if (!dir) return;
      setCheckoutSelected(prev => {
        const next = nav[prev]?.[dir];
        return (next as CheckoutOption) ?? prev;
      });
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [stage, showClienteModal]);

  // Keep pdvModalOpen in sync so Layout can skip its key handling while a modal is open
  useEffect(() => {
    pdvModalOpen = showExitConfirm || showQuantityModal || showClienteModal || stage === 'checkout';
    return () => { pdvModalOpen = false; };
  }, [showExitConfirm, showQuantityModal, showClienteModal, stage]);

  // Register navigate-away interceptor so Layout can ask PDV before leaving
  useEffect(() => {
    pdvNavigateAwayInterceptor = () => {
      if (cart.length > 0) {
        setExitConfirmSelected('exit');
        setShowExitConfirm(true);
        return true; // blocked
      }
      return false; // free to navigate
    };
    return () => { pdvNavigateAwayInterceptor = null; };
  }, [cart.length]);

  useEffect(() => {
    if (!showExitConfirm) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setExitConfirmSelected(prev => prev === 'exit' ? 'continue' : 'exit');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (exitConfirmSelected === 'exit') {
          setCart([]);
          setShowExitConfirm(false);
          setStage('date');
          setTimeout(() => {
            const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
            activeSidebarLink?.focus();
          }, 0);
        } else {
          setShowExitConfirm(false);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowExitConfirm(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showExitConfirm, exitConfirmSelected]);

  // Focus quantity modal: Select everything for quick replacement
  useEffect(() => {
    if (showQuantityModal && modalQuantityRef.current) {
      setTimeout(() => {
        modalQuantityRef.current?.focus();
        modalQuantityRef.current?.select();
      }, 50);
    }
  }, [showQuantityModal]);

  // Keep ref in sync so capture-phase handler always sees latest value
  useEffect(() => { editingItemIdRef.current = editingItemId; }, [editingItemId]);

  useEffect(() => {
    if (editingItemId && cartQuantityRef.current) {
      setTimeout(() => {
        cartQuantityRef.current?.focus();
        cartQuantityRef.current?.select();
      }, 50);
    }
  }, [editingItemId]);

  useEffect(() => {
    if (editingItemId === null) return;
    const q = parseFloat(quantityInput) || 0;
    setEditingTotalInput(formatCurrency(editingItemPrecoRef.current * q));
  }, [quantityInput, editingItemId]);

  const handleQuantityKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const isAllSelected = (input.selectionStart === 0 && input.selectionEnd === input.value.length);

    if (e.key === 'Escape') {
      e.preventDefault();
      setShowQuantityModal(false);
      setQuantityInput("1.000");
      setSelectedProduct(null);
      setTimeout(() => searchInputRef.current?.focus(), 0);
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (document.activeElement === modalQuantityRef.current) {
        addBtnRef.current?.focus();
      } else {
        modalQuantityRef.current?.focus();
      }
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (isAllSelected) {
        setQuantityInput("0.000");
        return;
      }
      const digits = quantityInput.replace(/\D/g, "");
      const newDigits = digits.substring(0, digits.length - 1).padStart(4, '0');
      const formatted = (parseInt(newDigits) / 1000).toFixed(3);
      setQuantityInput(formatted);
      return;
    }

    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      let digits = quantityInput.replace(/\D/g, "");
      
      if (isAllSelected) {
        digits = e.key.padStart(4, '0');
      } else {
        digits = (digits + e.key).replace(/^0+/, '').padStart(4, '0');
      }

      if (digits.length > 8) return; // Limit to 99999.999

      const formatted = (parseInt(digits) / 1000).toFixed(3);
      setQuantityInput(formatted);
    }
    
    // Ignore other keys like dots or commas in calculator mode
    if (e.key === '.' || e.key === ',') {
      e.preventDefault();
    }
  };

  // Keyboard navigation (selling stage only)
  useEffect(() => {
    if (stage !== 'selling') return;

    const enterProductZone = () => {
      setFocusedZone('products');
      setTimeout(() => productFocusTrapRef.current?.focus(), 0);
    };
    const enterCartZone = () => {
      setFocusedZone('cart');
      setFocusedCartIndex(prev => prev ?? 0);
      setFocusedCartAction(null);
      setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (showQuantityModal || showExitConfirm || showClienteModal || editingItemIdRef.current !== null) {
        return;
      }

      // F1: finalizar venda
      if (e.key === 'F1') {
        e.preventDefault(); e.stopPropagation();
        if (cart.length > 0) setStage('checkout');
        return;
      }

      // Tab: toggle zone (prevent default browser tab)
      if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        if (focusedZone === 'cart') enterProductZone();
        else if (cart.length > 0) enterCartZone();
        return;
      }

      // ESC: global exit or clear
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (showExitConfirm) { setShowExitConfirm(false); return; }
        if (focusedZone === 'cart') {
          enterProductZone(); return;
        }
        if (focusedProductIndexRef.current !== null) {
          focusedProductIndexRef.current = null;
          setFocusedProductIndex(null);
          return;
        }
        if (search.length > 0) { setSearch(''); setProducts([]); return; }
        if (cart.length > 0) { setExitConfirmSelected('exit'); setShowExitConfirm(true); }
        else { setStage('date'); }
        return;
      }

      // ── CART ZONE ──────────────────────────────────────────────────
      if (focusedZone === 'cart') {
        e.stopPropagation();

        // Confirm delete sub-mode
        if (confirmDeleteIdx !== null) {
          e.preventDefault();
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { /* visual only */ }
          else if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') {
            setCart(prev => prev.filter((_, i) => i !== confirmDeleteIdx));
            setFocusedCartIndex(null); setFocusedCartAction(null); setConfirmDeleteIdx(null);
            enterProductZone();
          } else if (e.key === 'Escape' || e.key === 'n' || e.key === 'N') {
            setConfirmDeleteIdx(null); setFocusedCartAction(null);
            setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
          }
          return;
        }

        // Action buttons sub-mode (Editar / Remover)
        if (focusedCartIndex !== null && focusedCartAction !== null) {
          e.preventDefault();
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            setFocusedCartAction(prev => prev === 'edit' ? 'delete' : 'edit');
          } else if (e.key === 'Enter') {
            if (focusedCartAction === 'edit') {
              const item = cart[focusedCartIndex];
              editingItemPrecoRef.current = Number(item.preco);
              setEditingItemId(item.id);
              setQuantityInput(item.quantidade.toFixed(3));
              setEditingTotalInput(formatCurrency(Number(item.preco) * Number(item.quantidade)));
              setFocusedCartAction(null);
            } else {
              setConfirmDeleteIdx(focusedCartIndex);
            }
          } else if (e.key === 'Escape') {
            setFocusedCartAction(null);
            setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
          }
          return;
        }

        // Cart item list navigation
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedCartIndex(prev => prev !== null ? Math.min(prev + 1, cart.length - 1) : 0);
          setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedCartIndex(prev => prev !== null && prev > 0 ? prev - 1 : 0);
          setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          setFocusedCartAction('edit');
        } else if (e.key === 'ArrowLeft' || e.key === 'Tab') {
          e.preventDefault();
          enterProductZone();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault(); // no-op, already rightmost
        }
        return;
      }

      // ── PRODUCT ZONE (or no zone yet) ─────────────────────────────
      // ArrowRight / ArrowLeft / Tab: handle zone transitions or text nav
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // If typing in search, let arrows work normally for text navigation
        if (document.activeElement === searchInputRef.current) return;

        if (e.key === 'ArrowRight' && cart.length > 0) {
          e.preventDefault(); e.stopPropagation(); enterCartZone();
        }
        return;
      }

      // ArrowDown/Up: navigate product results (auto-enter product zone)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        if (focusedZone !== 'products') setFocusedZone('products');
        const curIdx = focusedProductIndexRef.current;
        if (e.key === 'ArrowDown') {
          if (products.length > 0) {
            const next = curIdx === null ? 0 : Math.min(curIdx + 1, products.length - 1);
            focusedProductIndexRef.current = next;
            setFocusedProductIndex(next);
          }
        } else {
          if (curIdx === null || curIdx === 0) {
            focusedProductIndexRef.current = null;
            setFocusedProductIndex(null);
          } else {
            const prev = curIdx - 1;
            focusedProductIndexRef.current = prev;
            setFocusedProductIndex(prev);
          }
        }
        return;
      }

      // Enter: add focused product to cart
      if (e.key === 'Enter' && focusedProductIndexRef.current !== null && products[focusedProductIndexRef.current]) {
        e.preventDefault(); e.stopPropagation();
        handleProductSelect(products[focusedProductIndexRef.current]);
        focusedProductIndexRef.current = null;
        setFocusedProductIndex(null);
        return;
      }

      // Printable key while focus trap is active → forward to search input
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && document.activeElement === productFocusTrapRef.current) {
        searchInputRef.current?.focus();
        // Let the event propagate so the character lands in the input
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [stage, cart, cart.length, showExitConfirm, products, focusedProductIndex, search, focusedCartIndex, focusedCartAction, confirmDeleteIdx, focusedZone, editingItemId, showQuantityModal, showClienteModal]);

  const loadClientes = async () => {
    if (!db) return;
    const rows: any[] = await db.select("SELECT id, nome, telefone FROM clientes ORDER BY nome");
    setClientes(rows);
  };

  const handleFinalize = async (metodo: string, clienteId?: number) => {
    if (!db || cart.length === 0) return;

    try {
      const itemsInput = cart.map(i => ({
        produtoId: i.id,
        quantidade: i.quantidade,
        precoUnitario: i.preco
      }));
      const isoDate = vendaDate.split('/').reverse().join('-');

      if (metodo === 'prazo' && clienteId) {
        // Registra no FIFO normalmente (priorizando data da venda)
        await processarVendaFIFO(db, itemsInput, 'prazo', total, isoDate);
        // Também registra em vendas_prazo
        const res = await db.execute(
          "INSERT INTO vendas_prazo (cliente_id, data_venda, total) VALUES ($1, $2, $3)",
          [clienteId, isoDate, total]
        );
        const vendaIdPrazo = res.lastInsertId;
        for (const item of cart) {
          await db.execute(
            "INSERT INTO vendas_prazo_itens (venda_id, produto_nome, quantidade, valor_total) VALUES ($1, $2, $3, $4)",
            [vendaIdPrazo, item.nome, item.quantidade, item.preco * item.quantidade]
          );
        }
      } else {
        await processarVendaFIFO(db, itemsInput, metodo, total, isoDate);
      }

      setCart([]);
      setClienteSelecionado(null);
      setShowClienteModal(false);
      setVendaSuccess(metodo === 'prazo' ? `Venda lançada no prazo para ${clienteSelecionado?.nome}!` : 'Venda realizada com sucesso!');
      setStage('date');
      const now = new Date();
      setDateDigits(
        String(now.getDate()).padStart(2,'0') +
        String(now.getMonth()+1).padStart(2,'0') +
        String(now.getFullYear())
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("Erro ao processar venda:", msg);
      alert("Erro ao processar venda: " + msg);
    }
  };

  const handleAPrazo = async () => {
    await loadClientes();
    setClienteSearch('');
    setClienteSelecionado(null);
    setShowClienteModal(true);
  };

  // Stage: Date Selection
  if (stage === 'date') {
    // dateDigits é sempre string de 8 chars com dígitos ou '_'
    // ex: "11042026" ou "1_042026"

    const isValidDate = (day: number, month: number, year: number): boolean => {
      if (day < 1 || day > 31 || month < 1 || month > 12) return false;
      const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) daysInMonth[1] = 29;
      return day <= daysInMonth[month - 1];
    };

    // Formata para exibição com barras
    const displayValue = dateDigits.slice(0, 2) + '/' + dateDigits.slice(2, 4) + '/' + dateDigits.slice(4, 8);

    // Converte posição no display (com barras) para posição nos dígitos
    const displayToDigitPos = (displayPos: number) => {
      if (displayPos <= 2) return displayPos;
      if (displayPos <= 5) return displayPos - 1;
      return displayPos - 2;
    };

    // Converte posição nos dígitos para posição no display
    const digitToDisplayPos = (digitPos: number) => {
      if (digitPos <= 2) return digitPos;
      if (digitPos <= 4) return digitPos + 1;
      return digitPos + 2;
    };

    return (
      <div className="flex flex-col h-full justify-center items-center gap-8">
        <div className="text-center mb-8">
          <h2 className="text-4xl font-black italic text-luxury-orange uppercase mb-2">Data da Venda</h2>
          <p className="text-white/40">Digite a data (DD/MM/YYYY)</p>
        </div>

        <div className="text-center">
          <input
            ref={dateInputRef}
            type="text"
            value={displayValue}
            onChange={() => {}}
            onKeyDown={(e) => {
              const input = e.currentTarget;
              const displayPos = input.selectionStart ?? 0;
              // Converte posição do display para posição nos dígitos
              const pos = displayToDigitPos(displayPos);

              if (e.key === 'Escape' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || (e.key === 'ArrowLeft' && displayPos === 0)) {
                e.preventDefault();
                e.stopPropagation();
                
                // Reset to today's date when escaping to sidebar
                setDateDigits(getTodayDigits());
                setDateError('');
                
                const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
                activeSidebarLink?.focus();
                return;
              }

              if (e.key === 'Enter') {
                e.preventDefault();
                if (dateDigits.includes('_')) {
                  setDateError('Preencha a data completa.');
                  return;
                }
                const d = parseInt(dateDigits.slice(0, 2));
                const m = parseInt(dateDigits.slice(2, 4));
                const y = parseInt(dateDigits.slice(4, 8));

                if (d < 1 || d > 31) {
                  setDateError(`Dia inválido: ${d}. Deve ser entre 01 e 31.`);
                } else if (m < 1 || m > 12) {
                  setDateError(`Mês inválido: ${m}. Deve ser entre 01 e 12.`);
                } else if (!isValidDate(d, m, y)) {
                  setDateError(`${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y} não existe.`);
                } else {
                  const dd = dateDigits.slice(0, 2);
                  const mm = dateDigits.slice(2, 4);
                  const yyyy = dateDigits.slice(4, 8);
                  setVendaDate(`${dd}/${mm}/${yyyy}`);
                  setStage('selling');
                  setDateError('');
                }
                return;
              }

              if (/^\d$/.test(e.key)) {
                e.preventDefault();
                if (pos >= 8) return;
                const newDigits = dateDigits.slice(0, pos) + e.key + dateDigits.slice(pos + 1);
                setDateDigits(newDigits);
                setDateError('');
                const nextDigitPos = pos + 1;
                const nextDisplayPos = digitToDisplayPos(nextDigitPos);
                setTimeout(() => {
                  input.setSelectionRange(nextDisplayPos, nextDisplayPos);
                }, 0);
                return;
              }

              if (e.key === 'Backspace') {
                e.preventDefault();
                if (pos === 0) return;
                const newDigits = dateDigits.slice(0, pos - 1) + '_' + dateDigits.slice(pos);
                setDateDigits(newDigits);
                const prevDigitPos = pos - 1;
                const prevDisplayPos = digitToDisplayPos(prevDigitPos);
                setTimeout(() => {
                  input.setSelectionRange(prevDisplayPos, prevDisplayPos);
                }, 0);
                return;
              }

              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
              e.preventDefault();
            }}
            maxLength={10}
            className="luxury-input w-80 h-16 text-center text-3xl font-black tracking-wider"
            style={{ fontFamily: 'monospace' }}
          />
          {dateError && (
            <p className="text-red-500 text-sm mt-4">{dateError}</p>
          )}
        </div>

        <p className="text-white/40 text-sm">Pressione ENTER para continuar</p>
      </div>
    );
  }

  // Stage: Selling
  if (stage === 'selling') {

    return (
      <div className="flex flex-col h-full gap-4 p-4">
        {/* Header */}
        <header className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-3xl font-bold italic text-luxury-orange uppercase">VENDA - {vendaDate}</h2>
            <p className="text-white/40 text-xs mt-1">Escaneie ou digite o código/nome do produto</p>
          </div>
          <div className="glass-card px-6 py-4 flex flex-col items-end">
            <span className="text-[10px] uppercase text-white/40 font-bold">TOTAL</span>
            <span className="text-3xl font-black text-luxury-orange">R$ {total.toFixed(2)}</span>
          </div>
        </header>

        {/* Atalhos Info */}
        <div className="glass-card px-4 py-2 flex gap-6 text-xs font-bold text-white/40">
          <span><span className="text-luxury-orange">F1</span> = Finalizar</span>
          <span><span className="text-luxury-orange">TAB</span> = Alternar zona</span>
          <span><span className="text-luxury-orange">↑↓</span> = Navegar</span>
          <span><span className="text-luxury-orange">ENTER</span> = Adicionar / Editar</span>
          <span><span className="text-luxury-orange">ESC</span> = Sair</span>
        </div>

        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* Left: Search */}
          <div className={`flex-1 glass-card flex flex-col transition-all ${focusedZone === 'products' ? 'ring-1 ring-luxury-orange/30' : ''}`}>
            {/* Invisible focus trap for product zone */}
            <div ref={productFocusTrapRef} tabIndex={-1} className="outline-none w-0 h-0 overflow-hidden" />
              <div className="p-4 border-b border-white/5">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Código ou nome (máx 40 caracteres)..."
                  className="luxury-input w-full h-12 text-lg"
                  value={search}
                  onChange={e => {
                    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
                    if (val.length > 40) val = val.slice(0, 40);
                    setSearch(val);
                  }}
                  maxLength={40}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') e.preventDefault();
                  }}
                />
                {products.length > 0 && (
                  <p className="text-white/40 text-xs mt-2">{products.length} resultado(s)</p>
                )}
              </div>

              {/* Product List */}
              <div className="flex-1 overflow-auto p-3 space-y-2">
                {products.length > 0 ? (
                  products.map((product, pidx) => (
                    <button
                      key={product.id}
                      onClick={() => { setFocusedProductIndex(null); handleProductSelect(product); }}
                      className={`w-full p-3 rounded-lg text-left transition-all border relative overflow-hidden ${
                        focusedProductIndex === pidx
                          ? 'bg-luxury-orange/20 border-luxury-orange shadow-lg shadow-luxury-orange/10 scale-[1.01]'
                          : 'bg-white/5 hover:bg-white/10 border-white/5 hover:border-white/10'
                      }`}
                    >
                      {focusedProductIndex === pidx && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-luxury-orange shadow-[0_0_10px_rgba(255,107,0,0.5)]" />
                      )}
                      <h4 className={`font-bold transition-colors ${focusedProductIndex === pidx ? 'text-luxury-orange' : 'text-white'}`}>
                        {product.nome}
                      </h4>
                      <div className="flex justify-between text-white/40 text-xs mt-1">
                        <span>Cód: {product.codigo_barras || 'N/A'}</span>
                        <span className={`font-black ${focusedProductIndex === pidx ? 'text-white' : 'text-luxury-orange'}`}>
                          R$ {product.preco_venda.toFixed(2)}
                        </span>
                      </div>
                    </button>
                  ))
                ) : search.length > 0 ? (
                  <div className="h-full flex items-center justify-center text-white/10 italic">
                    <p>Nenhum produto</p>
                  </div>
                ) : null}
              </div>

              <div className="p-3 border-t border-white/5">
                <button
                  onClick={() => setStage('checkout')}
                  disabled={cart.length === 0}
                  className="btn-primary w-full h-10 text-sm uppercase disabled:opacity-30 disabled:grayscale"
                >
                  Finalizar Venda
                </button>
              </div>
            </div>

          {/* Right: Cart */}
          <div className={`flex-[0.8] glass-card flex flex-col transition-all ${focusedZone === 'cart' ? 'ring-1 ring-luxury-orange/30' : ''}`}>
            {/* Invisible focus trap — keeps isMainFocused=true after edit confirmation */}
            <div ref={cartFocusTrapRef} tabIndex={-1} className="outline-none w-0 h-0 overflow-hidden" />
            <div className="p-4 border-b border-white/5">
              <h3 className="text-lg font-bold uppercase italic text-luxury-orange">CARRINHO ({cart.length})</h3>
            </div>

            <div className="flex-1 overflow-auto p-3 space-y-2">
              {cart.length === 0 ? (
                <div className="h-full flex items-center justify-center text-white/10 italic">
                  <p className="text-xs">VAZIO</p>
                </div>
              ) : (
                cart.map((item, idx) => (
                  <div
                    key={`${item.id}-${idx}`}
                    className={`p-3 rounded-lg border transition-all cursor-pointer ${
                      focusedCartIndex === idx
                        ? 'bg-luxury-orange/20 border-luxury-orange/50'
                        : 'bg-white/5 border-white/5 hover:bg-white/10'
                    } ${lastAddedId === item.id ? 'animate-item-flash' : ''}`}
                    onClick={() => { if (editingItemId === item.id) return; setFocusedCartIndex(idx); setFocusedCartAction(null); setConfirmDeleteIdx(null); setEditingItemId(null); }}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-bold text-sm flex-1 truncate pr-2">{item.nome}</h4>
                      <span className="text-white/40 text-xs shrink-0">{item.quantidade.toFixed(3)}x</span>
                    </div>
                    <div className="flex justify-between text-xs text-white/40">
                      <span>R$ {item.preco.toFixed(2)}/un</span>
                      <span className="text-luxury-orange font-black">R$ {(item.preco * item.quantidade).toFixed(2)}</span>
                    </div>

                    {/* Action icons — shown when item is focused */}
                    {focusedCartIndex === idx && !editingItemId && confirmDeleteIdx !== idx && (
                      <div className="mt-2 flex gap-2">
                        <button
                          tabIndex={-1}
                          onClick={e => { 
                            e.stopPropagation(); 
                            editingItemPrecoRef.current = Number(item.preco);
                            setEditingItemId(item.id);
                            setQuantityInput(item.quantidade.toFixed(3));
                            setEditingTotalInput(formatCurrency(Number(item.preco) * Number(item.quantidade)));
                            setFocusedCartAction(null); 
                          }}
                          className={`flex-1 flex items-center justify-center gap-1 h-7 rounded text-xs font-bold transition-all ${
                            focusedCartAction === 'edit'
                              ? 'bg-luxury-orange text-white'
                              : 'bg-white/10 hover:bg-luxury-orange/40 text-white/70'
                          }`}
                        >
                          <Pencil size={12} /> Editar
                        </button>
                        <button
                          tabIndex={-1}
                          onClick={e => { e.stopPropagation(); setConfirmDeleteIdx(idx); setFocusedCartAction('delete'); }}
                          className={`flex-1 flex items-center justify-center gap-1 h-7 rounded text-xs font-bold transition-all ${
                            focusedCartAction === 'delete'
                              ? 'bg-red-500 text-white'
                              : 'bg-red-500/10 hover:bg-red-500/30 text-red-400'
                          }`}
                        >
                          <Trash2 size={12} /> Remover
                        </button>
                      </div>
                    )}

                    {/* Confirm delete */}
                    {confirmDeleteIdx === idx && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-white/60 font-bold flex-1">Remover item?</span>
                        <button
                          tabIndex={-1}
                          onClick={e => { e.stopPropagation(); setCart(prev => prev.filter((_, i) => i !== idx)); setFocusedCartIndex(null); setFocusedCartAction(null); setConfirmDeleteIdx(null); setTimeout(() => searchInputRef.current?.focus(), 0); }}
                          className="px-3 h-7 rounded text-xs font-bold bg-red-500 hover:bg-red-600 text-white transition-all"
                        >
                          Sim
                        </button>
                        <button
                          tabIndex={-1}
                          onClick={e => { e.stopPropagation(); setConfirmDeleteIdx(null); setFocusedCartAction(null); }}
                          className="px-3 h-7 rounded text-xs font-bold bg-white/10 hover:bg-white/20 text-white/70 transition-all"
                        >
                          Não
                        </button>
                      </div>
                    )}

                    {editingItemId === item.id && (
                      <div className="mt-2 flex flex-col gap-2 p-2 bg-black/40 rounded-lg border border-white/10">
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="text-[10px] uppercase text-white/40 font-bold block mb-1">QTD</label>
                            <input
                              type="text"
                              value={quantityInput}
                              onChange={e => {
                                let val = e.target.value.replace(',', '.');
                                if (!/^\d*\.?\d*$/.test(val)) return;
                                const parts = val.split('.');
                                if (parts[0].length > 5) return;
                                if (parts[1] && parts[1].length > 3) return;
                                setQuantityInput(val);
                              }}
                              ref={cartQuantityRef}
                              onKeyDown={e => {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const qty = parseFloat(quantityInput.replace(',', '.'));
                                  if (isNaN(qty) || qty <= 0) return;
                                  const totalVal = parseCurrencyToNumber(editingTotalInput);
                                  const newPreco = totalVal / qty;
                                  setCart(prev => prev.map(it => it.id === item.id ? { ...it, quantidade: qty, preco: newPreco } : it));
                                  setEditingItemId(null);
                                  setQuantityInput("1.000");
                                  setFocusedCartIndex(idx);
                                  setFocusedCartAction(null);
                                  setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setEditingItemId(null);
                                  setQuantityInput("1.000");
                                  setFocusedCartIndex(idx);
                                  setFocusedCartAction(null);
                                  setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
                                } else if (e.key === 'ArrowRight') {
                                  e.preventDefault();
                                  cartTotalRef.current?.focus();
                                  cartTotalRef.current?.select();
                                } else {
                                  handleQuantityKeyDown(e);
                                }
                              }}
                              autoFocus
                              className="luxury-input w-full h-9 text-xs text-center"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] uppercase text-white/40 font-bold block mb-1">TOTAL (R$)</label>
                            <input
                              type="text"
                              value={editingTotalInput}
                              ref={cartTotalRef}
                              onChange={e => setEditingTotalInput(handleCurrencyInput(e.target.value))}
                              onKeyDown={e => {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const qty = parseFloat(quantityInput.replace(',', '.'));
                                  if (isNaN(qty) || qty <= 0) return;
                                  const totalVal = parseCurrencyToNumber(editingTotalInput);
                                  const newPreco = totalVal / qty;
                                  setCart(prev => prev.map(it => it.id === item.id ? { ...it, quantidade: qty, preco: newPreco } : it));
                                  setEditingItemId(null);
                                  setQuantityInput("1.000");
                                  setFocusedCartIndex(idx);
                                  setFocusedCartAction(null);
                                  setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setEditingItemId(null);
                                  setQuantityInput("1.000");
                                  setFocusedCartIndex(idx);
                                  setFocusedCartAction(null);
                                  setTimeout(() => cartFocusTrapRef.current?.focus(), 0);
                                } else if (e.key === 'ArrowLeft') {
                                  e.preventDefault();
                                  cartQuantityRef.current?.focus();
                                  cartQuantityRef.current?.select();
                                }
                              }}
                              className="luxury-input w-full h-9 text-xs text-center font-bold text-luxury-orange"
                            />
                          </div>
                        </div>
                        <p className="text-[9px] text-white/20 italic text-center">ENTER para confirmar</p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

          </div>
        </div>

        {/* Quantity Modal */}
        {showQuantityModal && selectedProduct && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) { setShowQuantityModal(false); setSelectedProduct(null); } }}>
            <div className="glass-card w-full max-w-sm p-8">
              <h3 className="text-2xl font-black mb-2 text-luxury-orange uppercase">{selectedProduct.nome}</h3>
              <p className="text-white/40 text-sm mb-6">R$ {selectedProduct.preco_venda.toFixed(2)}/un</p>

              <label className="text-xs uppercase text-white/40 font-bold block mb-2">Quantidade (máx 99999)</label>
              <input
                type="text"
                value={quantityInput}
                onChange={e => {
                  let val = e.target.value.replace(',', '.');
                  if (!/^\d*\.?\d*$/.test(val)) return;
                  const parts = val.split('.');
                  if (parts[0].length > 5) return; // 99999
                  if (parts[1] && parts[1].length > 3) return;
                  setQuantityInput(val);
                }}
                onKeyDown={e => {
                  handleQuantityKeyDown(e);
                  if (e.key === 'Enter') handleAddToCart();
                }}
                ref={modalQuantityRef}
                className="luxury-input w-full h-12 text-center text-2xl font-bold mb-6"
              />

              <div className="space-y-2">
                <button
                  ref={addBtnRef}
                  onClick={handleAddToCart}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      modalQuantityRef.current?.focus();
                    } else if (e.key === 'Escape') {
                      setShowQuantityModal(false);
                      setQuantityInput("1.000");
                      setSelectedProduct(null);
                      setTimeout(() => searchInputRef.current?.focus(), 0);
                    }
                  }}
                  className="btn-primary w-full h-10 uppercase text-sm"
                >
                  Adicionar (ENTER)
                </button>
                <button
                  onClick={() => {
                    setShowQuantityModal(false);
                    setQuantityInput("1.000");
                    setSelectedProduct(null);
                  }}
                  className="w-full h-10 border border-white/10 rounded-lg hover:bg-white/5 uppercase text-[10px] font-bold text-white/40"
                >
                  Cancelar (ESC)
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Exit Confirmation */}
        {showExitConfirm && createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowExitConfirm(false); }}>
            <div className="glass-card w-full max-w-sm p-8">
              <h3 className="text-xl font-black mb-4 text-white">Sair sem salvar?</h3>
              <p className="text-white/40 text-sm mb-6">Existem {cart.length} item(s) no carrinho que serão perdidos.</p>

              <div className="space-y-2">
                <button
                  onClick={() => {
                    setCart([]);
                    setShowExitConfirm(false);
                    setStage('date');
                    setTimeout(() => {
                      const activeSidebarLink = document.querySelector('aside nav a[class*="bg-luxury-orange"]') as HTMLElement;
                      activeSidebarLink?.focus();
                    }, 0);
                  }}
                  className={`btn-primary w-full h-10 uppercase text-sm transition-all ${exitConfirmSelected === 'exit' ? 'bg-red-600 ring-2 ring-white/50' : 'bg-red-600/50 hover:bg-red-600'}`}
                >
                  Sair e Limpar
                </button>
                <button
                  onClick={() => {
                    setShowExitConfirm(false);
                    setTimeout(() => searchInputRef.current?.focus(), 0);
                  }}
                  className={`w-full h-10 border rounded-lg uppercase text-xs font-bold transition-all ${exitConfirmSelected === 'continue' ? 'border-white/50 bg-white/10 ring-2 ring-white/30' : 'border-white/10 hover:bg-white/5'}`}
                >
                  Continuar
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  // Stage: Checkout
  const coSel = (id: CheckoutOption) => checkoutSelected === id;
  const coBtn = (id: CheckoutOption, extra?: string) =>
    `flex items-center gap-4 p-4 rounded-xl border transition-all text-left outline-none ${
      coSel(id)
        ? 'bg-luxury-orange border-luxury-orange shadow-lg shadow-luxury-orange/20'
        : `bg-white/5 border-white/5 hover:bg-white/10 ${extra ?? ''}`
    }`;

  if (stage === 'checkout') {
    return (
      <>
      <div className="flex flex-col h-full justify-center items-center p-4">
        <div className="w-full max-w-xl flex flex-col gap-4">

          {/* Header: itens + data + total */}
          <div className="flex gap-3">
            <div className="glass-card px-5 py-4 flex flex-col items-center justify-center min-w-[80px]">
              <p className="text-[10px] uppercase text-white/40 font-bold mb-1">Itens</p>
              <p className="text-2xl font-black">{cart.length}</p>
            </div>
            <div className="glass-card flex-1 px-5 py-4">
              <p className="text-[10px] uppercase text-white/40 font-bold mb-1">Data</p>
              <p className="text-lg font-black">{vendaDate}</p>
            </div>
            <div className="glass-card flex-[2] px-5 py-4 border border-luxury-orange/30 bg-luxury-orange/5">
              <p className="text-[10px] uppercase text-white/40 font-bold mb-1">Total a Pagar</p>
              <p className="text-3xl font-black text-luxury-orange">R$ {total.toFixed(2)}</p>
            </div>
          </div>

          {vendaSuccess && (
            <div className="px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 font-bold text-sm">
              {vendaSuccess}
            </div>
          )}

          {/* Payment methods */}
          <div>
            <p className="text-[10px] uppercase text-white/40 font-bold mb-3 px-1">Forma de Pagamento</p>

            {/* 2×2 grid: Dinheiro, PIX, Crédito, Débito */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              {([
                { id: 'dinheiro' as CheckoutOption, label: 'Dinheiro', sub: 'À vista em espécie',       icon: Banknote   },
                { id: 'pix'      as CheckoutOption, label: 'PIX',      sub: 'Transferência instantânea', icon: QrCode     },
                { id: 'credito'  as CheckoutOption, label: 'Crédito',  sub: 'Cartão de crédito',        icon: CreditCard },
                { id: 'debito'   as CheckoutOption, label: 'Débito',   sub: 'Cartão de débito',         icon: Smartphone },
              ] as const).map(m => (
                <button key={m.id} onClick={() => handleFinalize(m.id)} className={coBtn(m.id)}>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${coSel(m.id) ? 'bg-white/20' : 'bg-luxury-orange/10'}`}>
                    <m.icon size={20} className={coSel(m.id) ? 'text-white' : 'text-luxury-orange'} />
                  </div>
                  <div>
                    <p className={`font-black uppercase text-sm ${coSel(m.id) ? 'text-white' : ''}`}>{m.label}</p>
                    <p className={`text-[10px] ${coSel(m.id) ? 'text-white/70' : 'text-white/40'}`}>{m.sub}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* A Prazo — final, linha cheia */}
            <button onClick={handleAPrazo} className={`w-full mb-3 ${coBtn('prazo')}`}>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${coSel('prazo') ? 'bg-white/20' : 'bg-luxury-orange/10'}`}>
                <Clock size={20} className={coSel('prazo') ? 'text-white' : 'text-luxury-orange'} />
              </div>
              <div>
                <p className={`font-black uppercase text-sm ${coSel('prazo') ? 'text-white' : 'text-luxury-orange'}`}>A Prazo</p>
                <p className={`text-[10px] ${coSel('prazo') ? 'text-white/70' : 'text-white/40'}`}>Registrar como fiado — selecionar cliente</p>
              </div>
            </button>
          </div>

          <button
            onClick={() => setStage('selling')}
            className="w-full h-9 border border-white/10 hover:bg-white/5 rounded-lg uppercase text-xs font-bold text-white/40 hover:text-white transition-all"
          >
            Voltar (ESC)
          </button>
        </div>
      </div>

      {/* Modal seleção de cliente para A Prazo */}
      {showClienteModal && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setShowClienteModal(false); }}>
          <div className="glass-card w-full max-w-xl p-8">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-xl font-black italic text-luxury-orange uppercase">Selecionar Cliente</h3>
              <button onClick={() => setShowClienteModal(false)} className="text-white/40 hover:text-white"><X size={20} /></button>
            </div>
            <input
              autoFocus
              type="text"
              placeholder="Buscar cliente..."
              className="luxury-input w-full h-11 mb-3"
              value={clienteSearch}
              onChange={e => { setClienteSearch(e.target.value.toUpperCase()); setClienteFocusedIdx(-1); setClienteSelecionado(null); }}
            />
            <div ref={clienteListRef} className="max-h-80 overflow-auto space-y-1 mb-4 pr-1">
              {(() => {
                const filtered = clientes.filter(c =>
                  c.nome.includes(clienteSearch) || (c.telefone || '').includes(clienteSearch)
                );
                clienteItemRefs.current = [];
                if (filtered.length === 0) return (
                  <p className="text-center text-white/30 text-sm py-6">Nenhum cliente encontrado</p>
                );
                return filtered.map((c, idx) => {
                  const isSelected = clienteSelecionado?.id === c.id;
                  const isFocused = clienteFocusedIdx === idx;
                  return (
                    <button
                      key={c.id}
                      ref={el => { clienteItemRefs.current[idx] = el; }}
                      onClick={() => { setClienteSelecionado({ id: c.id, nome: c.nome }); setClienteFocusedIdx(idx); }}
                      className={`w-full text-left px-4 py-3 rounded-xl transition-all font-semibold flex items-center gap-3 outline-none ${
                        isSelected
                          ? 'bg-luxury-orange text-white ring-2 ring-luxury-orange/50'
                          : isFocused
                          ? 'bg-luxury-orange/20 text-white ring-1 ring-luxury-orange/30'
                          : 'bg-white/5 hover:bg-white/10 text-white/80'
                      }`}
                    >
                      <span className={`text-xs font-mono shrink-0 ${isSelected ? 'text-white/70' : 'text-white/30'}`}>#{c.id}</span>
                      <span className="flex-1">{c.nome}</span>
                      {isSelected && <span className="text-xs text-white/60 font-normal">↵ confirmar</span>}
                    </button>
                  );
                });
              })()}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowClienteModal(false)} className="flex-1 h-12 border border-white/10 rounded-xl hover:bg-white/5 uppercase text-xs font-bold text-white/40 hover:text-white transition-all">Cancelar</button>
              <button
                disabled={!clienteSelecionado}
                onClick={() => clienteSelecionado && handleFinalize('prazo', clienteSelecionado.id)}
                className="btn-primary flex-1 h-12 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      </>
    );
  }
}
