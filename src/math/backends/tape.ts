/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import {NDArray, Scalar} from '../ndarray';

import {MathBackend} from './backend';
import {KernelNode, TapeNode} from './kernel_config';
import * as tape_util from './tape_util';

export class Tape {
  private evaluatedTapeNodes: TapeNode[] = [];

  private outputNodeMap: {[id: number]: TapeNode} = {};

  addEvaluatedNode(node: KernelNode) {
    this.outputNodeMap[node.output.id] = node;
    this.evaluatedTapeNodes.push(node);
  }

  gradientWrt(backend: MathBackend, y: Scalar, xs: NDArray[]): NDArray[] {
    if (this.outputNodeMap[y.id] == null) {
      throw new Error(`Cannot compute gradient: y is not part of this tape.`);
    }

    // Filter out the nodes that don't connect x => y.
    const filteredNodes =
        tape_util.getFilteredNodesXToY(this.evaluatedTapeNodes, xs, y);

    const arrayAccumulatedGradientMap: {[ndarrayId: number]: NDArray} = {};
    arrayAccumulatedGradientMap[y.id] = Scalar.new(1);

    // Walk the tape backwards and keep a map of NDArray to its gradient.
    for (let i = filteredNodes.length - 1; i >= 0; i--) {
      const node = filteredNodes[i];
      const dy = arrayAccumulatedGradientMap[node.output.id];

      if (node.gradient == null) {
        throw new Error(
            `Cannot compute gradient: gradient function not found for
            ${node.name}.`);
      }

      // Backprop dy through this node and accumulate gradients over the inputs.
      const inputGradients = node.gradient(dy, node.output);

      for (const inputName in inputGradients) {
        const grad = inputGradients[inputName];
        const activation = node.inputAndArgs.inputs[inputName];

        if (arrayAccumulatedGradientMap[activation.id] == null) {
          arrayAccumulatedGradientMap[activation.id] =
              inputGradients[inputName];
        } else {
          const curGradient = arrayAccumulatedGradientMap[grad.id];
          // Call the backend directly so we don't add the "add" node to our
          // tape.
          arrayAccumulatedGradientMap[grad.id] = backend.add(
              arrayAccumulatedGradientMap[grad.id], inputGradients[inputName]);
          curGradient.dispose();
        }
      }
    }

    const gradients: NDArray[] = [];
    for (let i = 0; i < xs.length; i++) {
      gradients.push(arrayAccumulatedGradientMap[xs[i].id]);
    }
    return gradients;
  }
}
