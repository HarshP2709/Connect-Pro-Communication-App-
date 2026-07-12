/**
 * ConnectPro — Landing Page JS
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  // Navbar scroll effect
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar?.classList.toggle('scrolled', window.scrollY > 20);
  });

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  });

  // Animate stats counter
  const animateCounter = (el, target, suffix = '') => {
    let current = 0;
    const step = target / 60;
    const timer = setInterval(() => {
      current += step;
      if (current >= target) { current = target; clearInterval(timer); }
      el.textContent = Number.isInteger(target) ? Math.floor(current) + suffix : current.toFixed(1) + suffix;
    }, 16);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const count = parseFloat(entry.target.dataset.count);
        const suffix = entry.target.dataset.suffix || (entry.target.dataset.count.includes('.') ? '' : '+');
        animateCounter(entry.target, count, suffix);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('[data-count]').forEach(el => observer.observe(el));

  // Feature cards animate on scroll
  const cardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        setTimeout(() => entry.target.style.opacity = '1', i * 80);
        entry.target.style.transform = 'none';
        cardObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.feature-card, .pricing-card').forEach((card, i) => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(24px)';
    card.style.transition = `opacity 0.5s ease, transform 0.5s var(--transition-spring)`;
    setTimeout(() => cardObserver.observe(card), 100);
  });

  // Join Meeting Modal
  const joinModal = document.getElementById('join-modal');
  document.getElementById('join-meeting-btn')?.addEventListener('click', () => joinModal?.classList.remove('hidden'));
  document.getElementById('join-modal-close')?.addEventListener('click', () => joinModal?.classList.add('hidden'));
  joinModal?.addEventListener('click', (e) => { if (e.target === joinModal) joinModal.classList.add('hidden'); });

  document.getElementById('join-meeting-confirm')?.addEventListener('click', () => {
    const id = document.getElementById('meeting-id-input')?.value.trim();
    if (!id) return Toast.warning('Meeting ID required', 'Please enter a meeting ID or link');
    if (!Auth.isLoggedIn()) {
      Toast.info('Sign in required', 'Please sign in to join a meeting');
      setTimeout(() => window.location.href = url('pages/auth/login.html'), 1500);
      return;
    }
    window.location.href = `/pages/meeting/room.html?id=${encodeURIComponent(id)}`;
  });

  // Redirect if already logged in
  if (Auth.isLoggedIn()) {
    const cta = document.querySelector('a[href*="register"]');
    if (cta) { cta.href = url('pages/dashboard/index.html'); cta.textContent = '🚀 Go to Dashboard'; }
  }
});

