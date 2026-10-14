# Vision

`ticktick-axi` is an agent-ergonomic interface to TickTick, built on the official [TickTick Open API](https://developer.ticktick.com/docs#/openapi).

## Scope

We aim for parity with the documented Open API.
Every capability the Open API documents should eventually be reachable through an AXI-native command.

We accept contributions that expose documented endpoints more ergonomically.
We do not call undocumented endpoints, scrape the web app, or add TickTick functionality the Open API cannot provide. Gaps are listed in the README's limitations instead.

## Interface

The interface must follow validated AXI principles and optimize for autonomous agent use.

Output may be structured, but its structure exists for agent comprehension rather than as a stable API for imperative programs.
Human-oriented presentation and compatibility work primarily serving hand-written parsers are not goals.

A person's task list is personal data. Reads are free; every write stays a dry run until the person confirms with `--yes`, and no write is retried automatically.
