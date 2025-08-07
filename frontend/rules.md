# Project Rules & Best Practices

This file documents the rules and guidelines for making changes to this codebase. Follow these to ensure stability, maintainability, and a high-quality user experience.

---

## 1. **Do Not Modify Critical Auth Code**
- Never change the AuthProvider or authentication logic without explicit permission.
- Always check with the team before altering anything related to authentication or security.

## 2. **API Integration**
- Always use environment variables for API URLs and secrets. Never hardcode them in the codebase.
- Validate all API responses and handle errors gracefully.
- Never expose sensitive API keys or credentials in client-side code.

## 3. **Component Changes**
- Reuse existing UI components where possible.
- Keep components small, focused, and reusable.
- Update or create new components in the `components/` directory.

## 4. **Code Quality**
- Use TypeScript for all files.
- Run `npm run lint` before committing changes.
- Write clear, descriptive commit messages.

## 5. **Styling**
- Use Tailwind CSS for all styling.
- Do not use inline styles unless absolutely necessary.

## 6. **Testing & Review**
- Test all changes locally before pushing.
- Get a code review for major changes.

## 7. **Documentation**
- Update this `rules.md` file if new rules are added.
- Document any new environment variables or major architectural decisions in the README.

## 8. **General**
- Ask for help if you are unsure about a change.
- Prioritize maintainability and clarity over cleverness.

---

**Following these rules will help keep the app stable and easy to work on for everyone!**
