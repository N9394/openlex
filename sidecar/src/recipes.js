"use strict"
/**
 * Drafting recipes (Batch 2.7): one-click drafting flows. Choosing a recipe
 * in the pane sends [recipe:id] + the user text; the chat route expands it
 * into a system-augmented prompt.
 */

const RECIPES = {}

function expand(message) {
  const m = String(message || '').match(/^\[recipe:([a-z_]+)\]\s*/)
  if (!m) return message
  const recipe = RECIPES[m[1]]
  if (!recipe) return message
  return recipe.prompt + '\n\n' + message.slice(m[0].length)
}

module.exports = { RECIPES, expand }
