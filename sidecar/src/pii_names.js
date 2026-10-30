"use strict"
/**
 * Common first names per country, for the redaction check's candidate
 * generation (pii_candidates.js): a first name followed by a capitalised
 * word is a likely person ("Johann Huber", "Jana Nováková"). A short seed
 * list of frequent given names from public name statistics; it finds
 * candidates, it does not decide — the decision model or the lawyer does.
 * Firms can add their own via openlex.json → "redaction": { "names": [] }.
 */

const NAMES = {
  de: 'Alexander Andrea Andreas Anna Barbara Bernhard Birgit Christian Christina Claudia Daniel David Elisabeth Eva Florian Franz Gabriele Georg Gerhard Hannah Hans Helmut Ingrid Jakob Johann Johanna Josef Julia Jürgen Karin Katharina Klaus Lukas Manfred Maria Markus Martin Matthias Michael Monika Paul Peter Petra Sabine Sandra Sarah Sebastian Stefan Susanne Thomas Tobias Ursula Wolfgang',
  en: 'Alice Amanda Andrew Anthony Barbara Charles Christopher Daniel David Elizabeth Emily Emma George Hannah James Jennifer Jessica John Joseph Karen Laura Linda Margaret Mark Mary Matthew Michael Nancy Olivia Patricia Paul Richard Robert Sarah Sophie Steven Susan Thomas William',
  fr: 'Alain Anne Antoine Camille Catherine Chloé Christophe Claire Émilie François Françoise Isabelle Jacques Jean Julien Léa Louis Lucie Manon Marie Martine Mathieu Michel Nathalie Nicolas Philippe Pierre Sophie Sylvie Thierry Valérie',
  cs: 'Eva Hana Jan Jana Jaroslav Jiří Josef Kateřina Lenka Lucie Marie Markéta Martin Michal Milan Miroslav Pavel Petr Petra Tomáš Václav Veronika Vladimír Zdeněk',
  sk: 'Anna Ján Jana Jozef Juraj Katarína Lucia Ľubomír Mária Marek Martin Michal Miroslav Peter Štefan Tomáš Vladimír Zuzana',
  pl: 'Agnieszka Andrzej Anna Barbara Ewa Grzegorz Jan Joanna Katarzyna Krzysztof Magdalena Małgorzata Marcin Marek Maria Michał Paweł Piotr Stanisław Tomasz Zofia',
  ro: 'Adrian Alexandru Ana Andrei Andreea Constantin Cristina Daniela Elena Gabriel Gheorghe Ioan Ion Ioana Maria Marian Mihai Nicolae Răzvan Vasile',
  hu: 'Andrea Anna Attila Balázs Erzsébet Éva Ferenc Gábor György István János József Katalin László Mária Péter Sándor Tamás Zoltán Zsófia',
  it: 'Alessandro Andrea Anna Antonio Chiara Francesca Francesco Giorgio Giovanni Giulia Giuseppe Laura Luca Marco Maria Matteo Paolo Roberto Sara Stefano',
}

const ALL = new Set(Object.values(NAMES).flatMap((s) => s.split(/\s+/)))

/** Is this word a common first name (any of our languages, or the firm's list)? */
function isFirstName(word, extra = null) {
  return ALL.has(word) || !!extra?.has(word)
}

module.exports = { NAMES, isFirstName }
