# GitHub Copilot Instructions

## Project overview
- This repository is an Angular 21 frontend application using TypeScript and standalone components.
- Main application code lives under src/app, with feature components in src/app/components, shared services in src/app/services, and models in src/app/models.

## Coding conventions
- Follow the existing Angular style and keep changes consistent with the current project structure.
- Prefer reusing existing services, models, and patterns before introducing new abstractions.
- Keep component logic, templates, and styles aligned; update the related .ts, .html, and .css files together when UI behavior changes.
- Preserve the existing routing, auth flow, and chat service behavior unless the request explicitly requires a change.

## Style and implementation guidance
- Use TypeScript types and keep code readable and explicit.
- Avoid hardcoding secrets or environment-specific values; place them in src/environments when needed.
- Prefer small, focused changes and avoid unrelated refactors.
- When adding features, follow the conventions already used in the existing components and services.

## Testing and validation
- When practical, verify changes with the relevant Angular build or test command.
- Keep unit tests aligned with the existing spec structure under src/app/components and src/app/shared.

## Scope guidance
- Do not introduce breaking changes to authentication, chat handling, or routing without clear justification.
- Keep changes scoped to the current request and avoid unnecessary dependency changes.
