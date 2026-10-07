// Datos de contacto de LM Creaciones: se completan acá y se usan en todas las
// páginas (portafolio y demos). Vacío = el botón se oculta.
const CONTACTO = {
  whatsapp: "5491139339282", // con código de país, sin + ni espacios
  email: "l.mazzolo94@gmail.com",
  instagram: "", // usuario sin @
};

(function () {
  const msg = encodeURIComponent("Hola! Vi tu portafolio de LM Creaciones y quiero consultarte por mi negocio.");
  const set = (selector, href) =>
    document.querySelectorAll(selector).forEach((a) => {
      if (href) a.href = href;
      else if (!a.classList.contains("btn-sm")) a.style.display = "none";
    });
  set(".js-wa", CONTACTO.whatsapp && `https://wa.me/${CONTACTO.whatsapp}?text=${msg}`);
  set(".js-mail", CONTACTO.email && `mailto:${CONTACTO.email}`);
  set(".js-ig", CONTACTO.instagram && `https://instagram.com/${CONTACTO.instagram}`);
})();
