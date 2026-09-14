import { LANTERN_COST, type LawnWardrobe } from "./wearables";

export interface Purse {
  coins: number;
}

export function bindShop(
  root: HTMLElement,
  wardrobe: LawnWardrobe,
  purse: Purse,
  onChange: (message: string) => void,
): { open: () => void; close: () => void; isOpen: () => boolean } {
  const sellList = root.querySelector("#shop-sell") as HTMLUListElement;
  const buyList = root.querySelector("#shop-buy") as HTMLUListElement;
  const coins = root.querySelector("#shop-coins") as HTMLElement;
  const closeBtn = root.querySelector("#shop-close") as HTMLButtonElement;

  const render = (): void => {
    coins.textContent = String(purse.coins);
    const goods = wardrobe.wornGoods();
    sellList.replaceChildren();
    if (goods.length === 0) {
      const empty = document.createElement("li");
      empty.className = "shop-empty";
      empty.textContent = "You are wearing nothing he will buy.";
      sellList.append(empty);
    } else {
      for (const good of goods) {
        const row = document.createElement("li");
        const label = document.createElement("span");
        label.textContent = `${good.title} · ${good.price} coppers`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Sell";
        btn.addEventListener("click", () => {
          const paid = wardrobe.sell(good.id);
          if (paid == null) return;
          purse.coins += paid;
          onChange(`Sold the ${good.title} for ${paid} coppers`);
          render();
        });
        row.append(label, btn);
        sellList.append(row);
      }
    }

    buyList.replaceChildren();
    const buy = document.createElement("li");
    const label = document.createElement("span");
    const owned = wardrobe.isWorn("lantern");
    label.textContent = owned
      ? "Brass lantern · already yours"
      : `Brass lantern · ${LANTERN_COST} coppers`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = owned ? "Owned" : "Buy";
    btn.disabled = owned || purse.coins < LANTERN_COST;
    btn.addEventListener("click", () => {
      if (purse.coins < LANTERN_COST || wardrobe.isWorn("lantern")) return;
      const got = wardrobe.buyLantern();
      if (!got) return;
      purse.coins -= LANTERN_COST;
      onChange(got);
      render();
    });
    buy.append(label, btn);
    buyList.append(buy);
  };

  const open = (): void => {
    root.hidden = false;
    render();
  };
  const close = (): void => {
    root.hidden = true;
  };

  closeBtn.addEventListener("click", close);
  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });

  return { open, close, isOpen: () => !root.hidden };
}

