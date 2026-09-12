// assets/js/lib/messaging.js
// Shared "message this person" entry point, called from wherever a buyer
// and seller need to start talking about a specific order (or, with no
// order_id, a general question) — the product quick-view, an order detail
// modal, etc. Used by both the buyer and seller apps; it only relies on
// generic classes (.modal-*, .field-*, .btn, .spinner) that both buyer.css
// and seller.css already define, so it needs no styling of its own.
//
// Two states:
//  - an existing thread with this recipient already exists (scoped to this
//    order, when an order_id is given — same dedup rule the backend's
//    POST /conversations uses) → skip straight to it, no extra click.
//  - no thread yet → a small compose modal collects the first message,
//    which both creates the conversation and sends it in one request.

import { api } from "../api.js";
import { getUser } from "../auth.js";
import { escapeHtml, toast, openModal, closeModal } from "./ui.js";

/* ================= attachments & reactions =================
 * Shared between buyer-messages.js and seller-messages.js (both render
 * the same thread/composer shape against the same /conversations API —
 * see those files' headers). Kept here as small pure helpers so the two
 * pages can't drift on the actual send-validation and reaction-toggle
 * rules, even though each renders its own markup. */

/** Mirrors SendMessageRequest::rules() on the backend — checked client-side
 * too so a bad file is rejected before the user waits on a round trip. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
export const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip";
const ALLOWED_ATTACHMENT_EXT = ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "zip"];

/** Quick client-side check before staging a file for send. Returns an
 * error string, or null if the file is fine. */
export function attachmentError(file) {
  if (file.size > MAX_ATTACHMENT_BYTES) return "Attachments must not be larger than 10MB.";
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_ATTACHMENT_EXT.includes(ext)) return "That file type isn't supported.";
  return null;
}

export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A small, deliberately short list — a full emoji keyboard is overkill for
 * reacting to a chat about an order. Same set both pages offer. */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/** Applies a tap on `emoji` to a message's existing (grouped) reactions
 * array the same way the backend's toggle endpoint would, so the UI can
 * update instantly and only reconcile with the server's response after —
 * see toggleReaction() in each messages page. */
export function applyOptimisticReaction(reactions, emoji) {
  const list = reactions ? reactions.map((r) => ({ ...r })) : [];
  const idx = list.findIndex((r) => r.emoji === emoji);
  if (idx === -1) {
    list.push({ emoji, count: 1, reacted_by_me: true });
    return list;
  }
  const r = list[idx];
  if (r.reacted_by_me) {
    if (r.count <= 1) {
      list.splice(idx, 1);
    } else {
      list[idx] = { ...r, count: r.count - 1, reacted_by_me: false };
    }
  } else {
    list[idx] = { ...r, count: r.count + 1, reacted_by_me: true };
  }
  return list;
}

/**
 * @param {Object} opts
 * @param {number} opts.recipientId - the other person's USER id (not a seller/buyer row id)
 * @param {string} [opts.recipientName] - display name shown in the compose modal
 * @param {number|null} [opts.orderId] - scopes the thread to one order, same as the backend
 * @param {number|null} [opts.productId] - the item being asked about (e.g. "Message" from a
 *   product's quick-view) — tags the thread server-side so both sides can see what it's about
 * @param {number|null} [opts.productVariationId] - the specific variant being asked about (e.g.
 *   "Small / Jersey Only"), if the buyer had one selected — scopes the thread server-side
 *   alongside productId, so different variants of the same product get their own conversation
 *   instead of folding into one.
 * @param {string} [opts.productName] - shown in the compose modal alongside a thumbnail, if given
 * @param {string} [opts.productImage] - thumbnail shown in the compose modal
 * @param {string} [opts.variationLabel] - human-readable form of productVariationId (e.g. "Small /
 *   Mbappe"), shown in the compose modal and folded into the first message's body (see
 *   openComposeModal) so it's visible in the thread transcript itself too, not just this modal.
 * @param {string} [opts.contextLabel] - short line under the recipient's name, e.g. "About Order #00042"
 * @param {string} opts.redirectTo - "/buyer/messages.html" or "/seller/messages.html"
 */
export async function messageUser({
  recipientId, recipientName = "", orderId = null, productId = null, productVariationId = null,
  productName = "", productImage = "", variationLabel = "", contextLabel = "", redirectTo,
}) {
  const me = getUser();
  // Both of these fail the same way today: nothing happens, no toast, no
  // console output — which is indistinguishable from the button being
  // broken. The most common way to actually hit the self-message case is a
  // dual-access (buyer+seller) account viewing its own shop/product page
  // from the buyer side and tapping its own "Message" button, so it's worth
  // surfacing rather than eating silently.
  if (!recipientId) {
    toast("This seller can't be messaged right now.", "error");
    return;
  }
  if (me && Number(me.id) === Number(recipientId)) {
    toast("You can't start a conversation with yourself.", "error");
    return;
  }

  try {
    const res = await api.get("/conversations");
    const conversations = res?.data || [];
    const existing = conversations.find((c) => {
      const other = c.participants?.[0];
      if (!other || Number(other.id) !== Number(recipientId)) return false;
      if (orderId) return Number(c.order_id) === Number(orderId);
      // Same fallback the backend uses: no order given means the thread is
      // scoped by product instead (or general, if neither was given) — and,
      // if a specific variant was picked, by that variant too, so a
      // different size/style of the same item never silently reuses
      // whatever thread the product last matched.
      if (!productId) return !c.order_id && !c.product;
      if (Number(c.product?.id) !== Number(productId)) return false;
      const existingVariationId = c.product?.variation?.id ?? null;
      return productVariationId
        ? Number(existingVariationId) === Number(productVariationId)
        : !existingVariationId;
    });
    if (existing) {
      window.location.href = `${redirectTo}?c=${existing.id}`;
      return;
    }
  } catch {
    // If the list fetch fails, fall through to the composer anyway —
    // POST /conversations still finds/reuses the right thread server-side,
    // it just won't skip the modal in the "already talking" case.
  }

  openComposeModal({ recipientId, recipientName, orderId, productId, productVariationId, productName, productImage, variationLabel, contextLabel, redirectTo });
}

function openComposeModal({ recipientId, recipientName, orderId, productId, productVariationId, productName, productImage, variationLabel, contextLabel, redirectTo }) {
  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>Message ${escapeHtml(recipientName || "this user")}</h3>
          ${contextLabel ? `<p>${escapeHtml(contextLabel)}</p>` : ""}
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        ${productId ? `
          <div class="msg-compose-product">
            ${productImage
              ? `<img src="${escapeHtml(productImage)}" alt="">`
              : `<span class="msg-compose-product-noimg">${escapeHtml((productName || "?").slice(0, 1).toUpperCase())}</span>`}
            <span class="msg-compose-product-name">
              ${escapeHtml(productName || "This item")}
              ${variationLabel ? `<span class="msg-compose-product-variation">${escapeHtml(variationLabel)}</span>` : ""}
            </span>
          </div>` : ""}
        <div class="field-group" style="margin-bottom:0;">
          <label for="msgComposeBody">Your message</label>
          <textarea id="msgComposeBody" rows="4" maxlength="2000" placeholder="Write your message…"></textarea>
          <div class="field-error" id="msgComposeError" hidden></div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" id="msgComposeSend">Send</button>
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

    const textarea = box.querySelector("#msgComposeBody");
    textarea.focus();
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        box.querySelector("#msgComposeSend").click();
      }
    });

    box.querySelector("#msgComposeSend").addEventListener("click", async () => {
      const body = textarea.value.trim();
      const errorBox = box.querySelector("#msgComposeError");
      errorBox.hidden = true;
      if (!body) {
        errorBox.textContent = "Write a message before sending.";
        errorBox.hidden = false;
        return;
      }
      const btn = box.querySelector("#msgComposeSend");
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>`;
      // The variation is still folded into the first message's own text
      // too (not just the product_variation_id column) — that's what makes
      // it visible in the thread transcript itself, for a seller reading
      // it later without cross-referencing a product page.
      const fullBody = variationLabel ? `[${variationLabel}] ${body}` : body;

      try {
        const res = await api.post("/conversations", {
          recipient_id: recipientId, order_id: orderId, product_id: productId,
          product_variation_id: productVariationId, body: fullBody,
        });
        closeModal();
        window.location.href = `${redirectTo}?c=${res.conversation.id}`;
      } catch (err) {
        errorBox.textContent = err.message || "Couldn't send that message.";
        errorBox.hidden = false;
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });
  }, { wide: false });
}
