export class Tree<K, T> {
  private readonly children: Map<K, Tree<K, T>> = new Map();

  constructor(readonly value: T, private readonly keyExtractor?: (value: T) => K) {
  }

  addChild(value: T, key: K = this.keyExtractor!(value)) {
    const tree = new Tree(value, this.keyExtractor);
    this.children.set(key, tree);
    return tree;
  }

  getChild(key: K) {
    return this.children.get(key);
  }

  getChildren(): IterableIterator<Tree<K, T>> {
    return this.children.values();
  }

  getChildKeys(): IterableIterator<K> {
    return this.children.keys();
  }
}